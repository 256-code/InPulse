import "reflect-metadata";
import { randomBytes, randomUUID } from "node:crypto";

import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { schemaRegistry } from "@inpulse/api-contract";
import {
  createDatabaseClient,
  type DatabaseClient,
} from "@inpulse/database/client";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AuthenticatedMutationService } from "../src/auth/authenticated-mutation.service.js";
import { VersionedHmacKeyring } from "../src/auth/keyring.js";
import { PostgresSessionCsrfTokenRepository } from "../src/auth/session-csrf-token.repository.js";
import { SessionAuthService } from "../src/auth/session-auth.service.js";
import { SessionTokenService } from "../src/auth/session-token.service.js";
import { PostgresUserSessionRepository } from "../src/auth/user-session.repository.js";
import { PostgresAuditWritePort } from "../src/audit/postgres-audit-write-port.js";
import { PostgresUnitOfWork } from "../src/database/unit-of-work.js";
import { ApiExceptionFilter } from "../src/http/api-exception.filter.js";
import { ContractResponseInterceptor } from "../src/http/contract-response.interceptor.js";
import { TimeCursorService } from "../src/cursors/time-cursor.js";
import { IdempotencyHttpService } from "../src/idempotency/http-service.js";
import { IdempotencyRunner } from "../src/idempotency/runner.js";
import { resolveRegisteredRoute } from "../src/idempotency/route.js";
import { PostgresIdempotencyStore } from "../src/idempotency/store.js";
import { PostgresActivityWritePort } from "../src/modules/activity/postgres-activity-write-port.js";
import { PostgresNotificationWritePort } from "../src/modules/notifications/postgres-notification-write-port.js";
import { PostgresProjectAccessQueryPort } from "../src/modules/projects/postgres-project-access-query-port.js";
import { PostgresProjectMembersQueryPort } from "../src/modules/projects/postgres-project-members-query-port.js";
import { PostgresProjectsWritePort } from "../src/modules/projects/postgres-projects-write-port.js";
import { ProjectManagementController } from "../src/modules/projects/project-management.controller.js";
import { ProjectManagementHttpService } from "../src/modules/projects/project-management-http.service.js";
import { ProjectManagementService } from "../src/modules/projects/project-management.service.js";
import { ProjectRoleGateService } from "../src/modules/projects/project-role-gate.service.js";
import { ProjectStartNotifier } from "../src/modules/projects/project-start.notifier.js";
import {
  PROJECT_DELETION_CURSOR_NAMESPACE,
  ProjectDeletionsQueryService,
} from "../src/modules/projects/project-deletions.query.service.js";
import { PostgresSearchProjectionWritePort } from "../src/modules/search/postgres-search-projection-write-port.js";
import {
  createProject,
  createUser,
  removeMember,
  testUrls,
  type ProjectFixture,
} from "./database.helpers.js";

let client: DatabaseClient;
let auditReader: DatabaseClient;
let unitOfWork: PostgresUnitOfWork;
let access: PostgresProjectAccessQueryPort;
let members: PostgresProjectMembersQueryPort;
let deletions: ProjectDeletionsQueryService;
let app: INestApplication | undefined;
let base: string;

const key = randomBytes(32);
const tokens = new SessionTokenService(
  VersionedHmacKeyring.fromEntries([{ version: 1, key }], 1),
);

interface Actor {
  readonly userId: number;
  readonly cookie: string;
  readonly csrf: string;
}

interface Fixture {
  readonly owner: Actor;
  readonly project: ProjectFixture;
}

async function actor(admin = false): Promise<Actor> {
  const userId = await createUser(client.sql, { admin });
  const cookie = randomBytes(32).toString("base64url");
  const csrf = randomBytes(32).toString("base64url");
  const [session] = await client.sql<Array<{ id: number }>>`
    INSERT INTO app.user_sessions (
      user_id,
      token_hash,
      token_hash_key_version,
      auth_version_at_issue,
      auth_state,
      idle_expires_at,
      absolute_expires_at
    )
    VALUES (
      ${userId},
      ${tokens.hash(cookie).hash},
      1,
      1,
      'AUTHENTICATED',
      now() + interval '1 hour',
      now() + interval '1 day'
    )
    RETURNING id
  `;
  await client.sql`
    INSERT INTO app.session_csrf_tokens (session_id, token_hash, expires_at)
    VALUES (
      ${session!.id},
      ${tokens.hash(csrf).hash},
      now() + interval '1 hour'
    )
  `;
  return { userId, cookie: `__Host-session=${cookie}`, csrf };
}

async function fixture(): Promise<Fixture> {
  const owner = await actor(false);
  const project = await createProject(client.sql, owner.userId);
  return { owner, project };
}

/** 把用户加入项目；默认普通成员，`role` 可显式指定组长。 */
async function join(
  projectId: number,
  userId: number,
  role: "MEMBER" | "LEADER" = "MEMBER",
): Promise<void> {
  await client.sql.begin(async (transaction) => {
    if (role === "LEADER") {
      await transaction`
        UPDATE app.project_members
           SET role = 'MEMBER'
         WHERE project_id = ${projectId}
           AND status = 'ACTIVE'
           AND role = 'LEADER'
      `;
    }
    await transaction`
      INSERT INTO app.project_members (project_id, user_id, role)
      VALUES (${projectId}, ${userId}, ${role})
    `;
  });
}

async function request(
  method: string,
  path: string,
  who?: Actor,
  options: {
    readonly key?: string;
    readonly csrf?: string;
    readonly body?: unknown;
    readonly omitCsrf?: boolean;
    readonly omitIdempotency?: boolean;
    readonly omitIfMatch?: boolean;
    readonly ifMatch?: string;
    readonly contentType?: string;
  } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    origin: base,
    "sec-fetch-site": "same-origin",
    ...(who === undefined ? {} : { cookie: who.cookie }),
    ...(options.omitCsrf === true
      ? {}
      : { "x-csrf-token": options.csrf ?? who?.csrf ?? "" }),
    ...(options.omitIfMatch === true
      ? {}
      : { "if-match": options.ifMatch ?? '"1"' }),
    ...(options.omitIdempotency === true
      ? {}
      : { "Idempotency-Key": options.key ?? randomUUID() }),
    ...(options.contentType === undefined
      ? {}
      : { "content-type": options.contentType }),
  };
  return fetch(`${base}/api/v1${path}`, {
    method,
    headers,
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  });
}

async function expectError(
  response: Response,
  status: number,
  code: string,
): Promise<void> {
  expect(response.status).toBe(status);
  const body = schemaRegistry.ErrorResponse.schema.parse(await response.json());
  expect(body.code).toBe(code);
  expect(response.headers.get("x-request-id")).toBe(body.requestId);
  expect(JSON.stringify(body)).not.toMatch(
    /INSERT INTO|SELECT |stack|constraint_name/i,
  );
}

/** 项目是否仍能从授权范围、写前校验与成员列表读到。 */
async function visibility(
  projectId: number,
  userId: number,
): Promise<{
  readonly inSearchScope: boolean;
  readonly writable: string;
  readonly memberProfiles: number;
}> {
  return unitOfWork.run(async (tx) => {
    const scope = await access.getAuthorizedSearchScope(userId);
    const check = await access.checkProjectForWrite(tx, {
      actorUserId: userId,
      projectId,
    });
    const profiles = await members.listActiveMemberProfiles(tx, {
      actorUserId: userId,
      projectId,
    });
    return {
      inSearchScope: scope.projectIds.includes(projectId),
      writable: check.kind,
      // undefined 表示项目不可访问，用 -1 与「空列表」区分开。
      memberProfiles: profiles?.length ?? -1,
    };
  });
}

async function projectRow(projectId: number): Promise<{
  readonly deletedAt: string | null;
  readonly deletedBy: number | null;
  readonly rowVersion: number;
}> {
  const rows = (await client.sql`
    SELECT deleted_at AS "deletedAt",
           deleted_by AS "deletedBy",
           row_version AS "rowVersion"
      FROM app.projects
     WHERE id = ${projectId}
  `) as unknown as readonly {
    deletedAt: string | null;
    deletedBy: number | null;
    rowVersion: number;
  }[];
  return rows[0]!;
}

/**
 * ADR-051：给项目造功能、任务、任务组关系与迭代记录草稿，彻底删除的外键顺序
 * 与行数统计才有真实数据可删。夹具直接写表、不走命令，因此不产生通知。
 *
 * 任务必须在**同一事务内**补状态历史：`tasks` 上有延迟约束触发器，提交时没有
 * 历史行就会报 `task N must have status history`。
 */
async function seedPurgeableRecords(
  project: ProjectFixture,
  actorId: number,
): Promise<void> {
  await client.sql.begin(async (transaction) => {
    const [feature] = await transaction<Array<{ id: number }>>`
      INSERT INTO app.features (project_id, module_id, code, name, created_by)
      VALUES (${project.projectId}, ${project.moduleId}, ${`${project.code}-F-1`}, ${"彻底删除用功能"}, ${actorId})
      RETURNING id
    `;
    const [main] = await transaction<Array<{ id: number }>>`
      INSERT INTO app.tasks (project_id, module_id, feature_id, scope_type, code, title, creator_id)
      VALUES (${project.projectId}, ${project.moduleId}, ${feature!.id}, 'FEATURE', ${`${project.code}-T-1`}, ${"彻底删除用主任务"}, ${actorId})
      RETURNING id
    `;
    const [source] = await transaction<Array<{ id: number }>>`
      INSERT INTO app.tasks (project_id, module_id, feature_id, scope_type, code, title, creator_id)
      VALUES (${project.projectId}, ${project.moduleId}, ${feature!.id}, 'FEATURE', ${`${project.code}-T-2`}, ${"彻底删除用来源任务"}, ${actorId})
      RETURNING id
    `;
    await transaction`
      INSERT INTO app.task_status_history (task_id, project_id, from_work_status, to_work_status, changed_by)
      VALUES (${main!.id}, ${project.projectId}, NULL, 'TODO', ${actorId}),
             (${source!.id}, ${project.projectId}, NULL, 'TODO', ${actorId})
    `;
    const [group] = await transaction<Array<{ id: number }>>`
      INSERT INTO app.task_groups (project_id, code, name, created_by)
      VALUES (${project.projectId}, ${`${project.code}-TG-1`}, ${"彻底删除用任务组"}, ${actorId})
      RETURNING id
    `;
    await transaction`
      INSERT INTO app.task_group_members (group_id, task_id, project_id, role)
      VALUES (${group!.id}, ${main!.id}, ${project.projectId}, 'MAIN')
    `;
    await transaction`
      INSERT INTO app.task_group_members (
        group_id,
        task_id,
        project_id,
        role,
        source_kind,
        original_work_status,
        original_assignee_id
      )
      VALUES (${group!.id}, ${source!.id}, ${project.projectId}, 'SOURCE', 'ACTIVE', 'TODO', ${actorId})
    `;
    await transaction`
      INSERT INTO app.change_records (project_id, module_id, scope_type, title, handler_id, author_id)
      VALUES (${project.projectId}, ${project.moduleId}, 'MODULE', ${"彻底删除用迭代记录"}, ${actorId}, ${actorId})
    `;
  });
}

/** `app.purge_project` 逐表删除的全部位置，用于验证「彻底删除后全表无残留」。 */
const PROJECT_SCOPED_TABLES = [
  "modules",
  "features",
  "tasks",
  "task_groups",
  "task_group_members",
  "task_status_history",
  "task_assignees",
  "task_feature_impacts",
  "task_external_links",
  "change_records",
  "change_record_versions",
  "change_record_leftover_items",
  "change_record_feature_impacts",
  "change_record_external_links",
  "change_record_version_leftovers",
  "leftover_task_links",
  "feature_external_links",
  "project_external_links",
  "external_links",
  "project_archive_requests",
  "code_sequences",
  "project_members",
  "notifications",
  "activity_projection",
  "search_projection",
] as const;

/** 审计表只有 `audit_reader` 可读，运行时角色没有 SELECT。 */
const PROJECT_AUDIT_TABLES = ["audit_logs", "audit_chain_heads"] as const;

const ALL_SCOPED_TABLES = [
  ...PROJECT_SCOPED_TABLES,
  ...PROJECT_AUDIT_TABLES,
] as const;

/** 按项目统计各表行数；表名来自上面的常量、ID 来自夹具自增主键，不拼接外部输入。 */
async function countProjectRows(
  sql: Sql,
  tables: readonly string[],
  projectId: number,
): Promise<Record<string, number>> {
  const id = Math.trunc(projectId);
  const union = tables
    .map(
      (table) =>
        `SELECT '${table}' AS table_name, count(*)::integer AS row_count FROM app.${table} WHERE project_id = ${id}`,
    )
    .join(" UNION ALL ");
  const rows = (await sql.unsafe(
    `SELECT * FROM (${union}) AS counts`,
  )) as unknown as readonly {
    readonly table_name: string;
    readonly row_count: number;
  }[];
  return Object.fromEntries(rows.map((row) => [row.table_name, row.row_count]));
}

/** 业务表与审计表分两路连接统计，调用方拿到合并后的全表行数。 */
async function projectRowCounts(
  projectId: number,
): Promise<Record<string, number>> {
  const [business, audit] = await Promise.all([
    countProjectRows(client.sql, PROJECT_SCOPED_TABLES, projectId),
    countProjectRows(auditReader.sql, PROJECT_AUDIT_TABLES, projectId),
  ]);
  return { ...business, ...audit };
}

/** PROJECT 链的哈希头仍与链上最后一条记录对齐（删除 / 还原都不得拆链）。 */
async function chainHeadMatches(projectId: number): Promise<boolean> {
  const rows = (await auditReader.sql`
    SELECT h.last_hash = last_row.record_hash AS "hashMatches",
           h.last_sequence = last_row.sequence_no AS "sequenceMatches"
      FROM app.audit_chain_heads h
      JOIN LATERAL (
        SELECT sequence_no, record_hash
          FROM app.audit_logs
         WHERE project_id = ${projectId}
         ORDER BY sequence_no DESC
         LIMIT 1
      ) AS last_row ON true
     WHERE h.chain_id = ${`PROJECT:${String(projectId)}`}
  `) as unknown as readonly {
    hashMatches: boolean;
    sequenceMatches: boolean;
  }[];
  return rows.length === 1 && rows[0]!.hashMatches && rows[0]!.sequenceMatches;
}

beforeAll(async () => {
  const urls = testUrls();
  client = createDatabaseClient(urls.runtime, {
    applicationName: "inpulse-adr049-project-delete",
  });
  auditReader = createDatabaseClient(urls.auditReader, {
    applicationName: "inpulse-adr049-project-delete-audit",
  });
  unitOfWork = new PostgresUnitOfWork(client);
  access = new PostgresProjectAccessQueryPort(client);
  members = new PostgresProjectMembersQueryPort();
  deletions = new ProjectDeletionsQueryService(
    client.sql,
    new TimeCursorService(
      VersionedHmacKeyring.fromEntries([{ version: 1, key }], 1),
      PROJECT_DELETION_CURSOR_NAMESPACE,
    ),
  );

  const csrf = new PostgresSessionCsrfTokenRepository();
  const auth = new SessionAuthService(
    unitOfWork,
    new PostgresUserSessionRepository(),
    tokens,
  );
  const service = new ProjectManagementService(
    new PostgresProjectsWritePort(),
    access,
    new PostgresAuditWritePort({ currentVersion: 1, keyFor: () => key }),
    new PostgresActivityWritePort(),
    new PostgresSearchProjectionWritePort(),
    members,
    new ProjectRoleGateService(access, members),
    new ProjectStartNotifier(members, new PostgresNotificationWritePort()),
  );
  const http = new ProjectManagementHttpService(
    new AuthenticatedMutationService(auth, csrf, tokens),
    new IdempotencyHttpService(
      new IdempotencyRunner(unitOfWork, new PostgresIdempotencyStore()),
      { currentVersion: 1, currentKey: () => key, keyFor: () => key },
      resolveRegisteredRoute,
    ),
    service,
  );

  class TestModule {}
  Module({
    controllers: [ProjectManagementController],
    providers: [{ provide: ProjectManagementHttpService, useValue: http }],
  })(TestModule);
  app = await NestFactory.create(TestModule, { logger: false });
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalInterceptors(new ContractResponseInterceptor());
  app.setGlobalPrefix("api/v1");
  await app.listen(0, "127.0.0.1");
  base = await app.getUrl();
});

afterAll(async () => {
  await app?.close();
  await client?.close();
  await auditReader?.close();
});

describe("ADR-049 project delete API", () => {
  it("组长删除项目：204 无正文、项目退出全部读取路径、业务历史保留", async () => {
    const value = await fixture();
    const path = `/projects/${value.project.projectId}`;
    const deleteKey = randomUUID();

    const before = await visibility(
      value.project.projectId,
      value.owner.userId,
    );
    expect(before).toMatchObject({
      inSearchScope: true,
      writable: "allowed",
      memberProfiles: 1,
    });

    const deleted = await request("DELETE", path, value.owner, {
      key: deleteKey,
    });
    expect(deleted.status).toBe(204);
    expect(await deleted.text()).toBe("");
    expect(deleted.headers.get("content-type")).toBeNull();

    expect(await projectRow(value.project.projectId)).toMatchObject({
      deletedBy: value.owner.userId,
      rowVersion: 2,
    });

    // 删除后组长自己也读不到、写不进，成员列表同理（undefined = 项目不可访问）。
    expect(
      await visibility(value.project.projectId, value.owner.userId),
    ).toMatchObject({
      inSearchScope: false,
      writable: "not-found",
      memberProfiles: -1,
    });

    // 项目本身消失，但模块、成员关系与审计链都还在。
    const retained = (await client.sql`
      SELECT (SELECT count(*) FROM app.modules
               WHERE project_id = ${value.project.projectId}) AS "modules",
             (SELECT count(*) FROM app.project_members
               WHERE project_id = ${value.project.projectId}
                 AND status = 'ACTIVE') AS "members"
    `) as unknown as readonly { modules: string; members: string }[];
    expect(retained[0]).toMatchObject({ modules: "1", members: "1" });

    const deleteAudits = (await auditReader.sql`
      SELECT count(*) AS "count"
        FROM app.audit_logs
       WHERE project_id = ${value.project.projectId}
         AND action = 'project.delete'
    `) as unknown as readonly { count: string }[];
    expect(deleteAudits[0]!.count).toBe("1");

    // 夹具直接插入项目、不走命令，因此这里只有删除事件；关键是删除没有拆链：
    // PROJECT 链头仍与该项目最后一条审计记录对得上。
    const audits = (await auditReader.sql`
      SELECT action AS "action"
        FROM app.audit_logs
       WHERE project_id = ${value.project.projectId}
       ORDER BY sequence_no ASC
    `) as unknown as readonly { action: string }[];
    expect(audits.map((row) => row.action)).toEqual(["project.delete"]);

    const heads = (await auditReader.sql`
      SELECT h.last_sequence AS "lastSequence",
             h.last_hash = last_row.record_hash AS "hashMatches",
             h.last_sequence = last_row.sequence_no AS "sequenceMatches"
        FROM app.audit_chain_heads h
        JOIN LATERAL (
          SELECT sequence_no, record_hash
            FROM app.audit_logs
           WHERE project_id = ${value.project.projectId}
           ORDER BY sequence_no DESC
           LIMIT 1
        ) AS last_row ON true
       WHERE h.chain_id = ${`PROJECT:${String(value.project.projectId)}`}
    `) as unknown as readonly {
      hashMatches: boolean;
      lastSequence: string;
      sequenceMatches: boolean;
    }[];
    expect(heads).toHaveLength(1);
    expect(heads[0]).toMatchObject({
      hashMatches: true,
      sequenceMatches: true,
    });

    const activity = (await client.sql`
      SELECT activity_type AS "activityType",
             summary AS "summary"
        FROM app.activity_projection
       WHERE project_id = ${value.project.projectId}
         AND activity_type = 'PROJECT_DELETED'
    `) as unknown as readonly { activityType: string; summary: string }[];
    expect(activity).toHaveLength(1);
    expect(activity[0]!.summary).toContain("删除了项目");

    // 通知不写：深链指向已不可见的项目。
    const notifications = (await client.sql`
      SELECT count(*) AS "count"
        FROM app.notifications
       WHERE project_id = ${value.project.projectId}
    `) as unknown as readonly { count: string }[];
    expect(notifications[0]!.count).toBe("0");
  });

  it("删除台账与审计都记下删除人：任何登录用户可读、管理员可查审计", async () => {
    const value = await fixture();
    const member = await actor(false);
    const outsider = await actor(false);
    await join(value.project.projectId, member.userId);

    expect(
      (
        await request(
          "DELETE",
          `/projects/${value.project.projectId}`,
          value.owner,
        )
      ).status,
    ).toBe(204);

    // 删除人姓名由服务端从 app.users 联表取出，页面直接可用。
    const [ownerRow] = (await client.sql`
      SELECT name FROM app.users WHERE id = ${value.owner.userId}
    `) as unknown as readonly { name: string }[];
    const ledgers = await deletions.query({
      actorUserId: outsider.userId,
    });
    const entry = ledgers.items.find(
      (item) => item.projectId === value.project.projectId,
    );
    expect(entry).toBeDefined();
    expect(entry).toMatchObject({
      code: value.project.code,
      deletedBy: { id: value.owner.userId, name: ownerRow!.name },
    });
    expect(entry!.deletedAt).toMatch(/Z$/);

    // 同一份事实在管理员可见的审计链里也留了痕：动作与操作者一致。
    const audits = (await auditReader.sql`
      SELECT action AS "action", actor_id AS "actorId"
        FROM app.audit_logs
       WHERE project_id = ${value.project.projectId}
       ORDER BY sequence_no DESC
       LIMIT 1
    `) as unknown as readonly { action: string; actorId: number | null }[];
    expect(audits[0]).toEqual({
      action: "project.delete",
      actorId: value.owner.userId,
    });
  });

  it("同 Key 同 If-Match 重放 204；换 If-Match 或换 Key 都不重放", async () => {
    const value = await fixture();
    const path = `/projects/${value.project.projectId}`;
    const deleteKey = randomUUID();

    expect(
      (await request("DELETE", path, value.owner, { key: deleteKey })).status,
    ).toBe(204);

    const replay = await request("DELETE", path, value.owner, {
      key: deleteKey,
    });
    expect(replay.status).toBe(204);
    expect(await replay.text()).toBe("");

    const row = await projectRow(value.project.projectId);
    expect(row.rowVersion).toBe(2);

    const repeatAudits = (await auditReader.sql`
      SELECT count(*) AS "count"
        FROM app.audit_logs
       WHERE project_id = ${value.project.projectId}
         AND action = 'project.delete'
    `) as unknown as readonly { count: string }[];
    expect(repeatAudits[0]!.count).toBe("1");

    // 同一把 Key、不同请求内容（If-Match 变了）→ 摘要不一致。
    await expectError(
      await request("DELETE", path, value.owner, {
        key: deleteKey,
        ifMatch: '"2"',
      }),
      409,
      "IDEMPOTENCY_REQUEST_MISMATCH",
    );

    // 换一把新 Key 重删：项目已不可写，按不存在处理。
    await expectError(
      await request("DELETE", path, value.owner),
      404,
      "PROJECT_NOT_FOUND",
    );
  });

  it("普通成员 403、非成员与已移除成员 404、系统管理员放行", async () => {
    const value = await fixture();
    const path = `/projects/${value.project.projectId}`;
    const member = await actor(false);
    const outsider = await actor(false);
    const removed = await actor(false);
    const admin = await actor(true);
    await join(value.project.projectId, member.userId);
    await join(value.project.projectId, removed.userId);
    await removeMember(client.sql, value.project.projectId, removed.userId);

    await expectError(
      await request("DELETE", path, member),
      403,
      "PROJECT_DELETE_FORBIDDEN",
    );
    await expectError(
      await request("DELETE", path, outsider),
      404,
      "PROJECT_NOT_FOUND",
    );
    await expectError(
      await request("DELETE", path, removed),
      404,
      "PROJECT_NOT_FOUND",
    );

    // 失败路径不得留下副作用：项目仍然可读可写。
    expect(await projectRow(value.project.projectId)).toMatchObject({
      deletedAt: null,
      deletedBy: null,
      rowVersion: 1,
    });
    expect(
      await visibility(value.project.projectId, value.owner.userId),
    ).toMatchObject({ inSearchScope: true, writable: "allowed" });

    const deleted = await request("DELETE", path, admin);
    expect(deleted.status).toBe(204);
    expect(await projectRow(value.project.projectId)).toMatchObject({
      deletedBy: admin.userId,
      rowVersion: 2,
    });
  });

  it("组长被转移或移除后不得重放；他人无法用同一把 Key 顶替", async () => {
    const value = await fixture();
    const successor = await actor(false);
    const path = `/projects/${value.project.projectId}`;
    const deleteKey = randomUUID();

    expect(
      (await request("DELETE", path, value.owner, { key: deleteKey })).status,
    ).toBe(204);

    // 组长身份转给新成员，原组长降为普通成员。
    await join(value.project.projectId, successor.userId, "LEADER");

    // 重放前重验原操作权限：原组长已降为普通成员，不得重放已存的 204。
    await expectError(
      await request("DELETE", path, value.owner, { key: deleteKey }),
      403,
      "PROJECT_DELETE_FORBIDDEN",
    );

    // 连成员关系也没了：按不存在处理，不泄露「此项目刚被删除」。
    await removeMember(client.sql, value.project.projectId, value.owner.userId);
    await expectError(
      await request("DELETE", path, value.owner, { key: deleteKey }),
      404,
      "PROJECT_NOT_FOUND",
    );

    // 幂等记录按操作者隔离，新组长用同一把 Key 也只是重新执行并撞上不可写。
    await expectError(
      await request("DELETE", path, successor, { key: deleteKey }),
      404,
      "PROJECT_NOT_FOUND",
    );
  });

  it("陈旧版本 409、缺 If-Match 422、缺幂等键 400、带请求体 422", async () => {
    const value = await fixture();
    const path = `/projects/${value.project.projectId}`;

    await client.sql`
      UPDATE app.projects
         SET row_version = row_version + 1
       WHERE id = ${value.project.projectId}
    `;
    await expectError(
      await request("DELETE", path, value.owner, { ifMatch: '"1"' }),
      409,
      "PROJECT_VERSION_CONFLICT",
    );

    await expectError(
      await request("DELETE", path, value.owner, { omitIfMatch: true }),
      422,
      "PROJECT_VALIDATION_FAILED",
    );
    await expectError(
      await request("DELETE", path, value.owner, { omitIdempotency: true }),
      400,
      "IDEMPOTENCY_KEY_REQUIRED",
    );
    await expectError(
      await request("DELETE", path, value.owner, {
        body: { reason: "误建" },
        contentType: "application/json",
      }),
      422,
      "PROJECT_VALIDATION_FAILED",
    );
    await expectError(
      await request("DELETE", path, value.owner, { omitCsrf: true }),
      422,
      "PROJECT_VALIDATION_FAILED",
    );
    await expectError(
      await request("DELETE", path, undefined, { csrf: "a".repeat(43) }),
      401,
      "PROJECT_SESSION_REQUIRED",
    );

    // 以上失败都不改动项目行；用当前版本号删除成功。
    expect(await projectRow(value.project.projectId)).toMatchObject({
      deletedAt: null,
      rowVersion: 2,
    });
    expect(
      (await request("DELETE", path, value.owner, { ifMatch: '"2"' })).status,
    ).toBe(204);
  });
});

describe("ADR-051 项目还原 API", () => {
  it("组长还原：清空软删除、项目回到全部读路径、审计与动态同事务留痕", async () => {
    const value = await fixture();
    const projectId = value.project.projectId;
    const path = `/projects/${projectId}`;

    expect((await request("DELETE", path, value.owner)).status).toBe(204);
    expect(await visibility(projectId, value.owner.userId)).toMatchObject({
      inSearchScope: false,
      writable: "not-found",
    });

    const restored = await request("POST", `${path}/restore`, value.owner, {
      omitIfMatch: true,
    });
    expect(restored.status).toBe(200);
    const body = schemaRegistry.ProjectDetailResponse.schema.parse(
      await restored.json(),
    );
    expect(body.project).toMatchObject({
      id: projectId,
      code: value.project.code,
      rowVersion: 3,
    });
    expect(body.currentUserRole).toBe("LEADER");

    // 还原不恢复数据，只清空软删除标记并递增版本。
    expect(await projectRow(projectId)).toMatchObject({
      deletedAt: null,
      deletedBy: null,
      rowVersion: 3,
    });
    expect(await visibility(projectId, value.owner.userId)).toMatchObject({
      inSearchScope: true,
      writable: "allowed",
      memberProfiles: 1,
    });

    // 删除台账不再列出该项目。
    const ledgers = await deletions.query({ actorUserId: value.owner.userId });
    expect(ledgers.items.some((item) => item.projectId === projectId)).toBe(
      false,
    );

    // 审计链追加 project.restore，链头仍与最后一条记录对齐。
    const audits = (await auditReader.sql`
      SELECT action AS "action", actor_id AS "actorId"
        FROM app.audit_logs
       WHERE project_id = ${projectId}
       ORDER BY sequence_no ASC
    `) as unknown as readonly { action: string; actorId: number | null }[];
    expect(audits.map((row) => row.action)).toEqual([
      "project.delete",
      "project.restore",
    ]);
    expect(audits[1]!.actorId).toBe(value.owner.userId);
    expect(await chainHeadMatches(projectId)).toBe(true);

    // 项目动态按链序追加 PROJECT_RESTORED，搜索投影按新版本重建。
    const activity = (await client.sql`
      SELECT activity_type AS "activityType", summary AS "summary"
        FROM app.activity_projection
       WHERE project_id = ${projectId}
       ORDER BY source_sequence ASC
    `) as unknown as readonly { activityType: string; summary: string }[];
    expect(activity.map((row) => row.activityType)).toEqual([
      "PROJECT_DELETED",
      "PROJECT_RESTORED",
    ]);
    expect(activity[1]!.summary).toContain("还原了项目");

    const projection = (await client.sql`
      SELECT title AS "title",
             visibility_scope AS "visibilityScope",
             source_row_version AS "sourceRowVersion"
        FROM app.search_projection
       WHERE project_id = ${projectId}
         AND entity_type = 'PROJECT'
         AND entity_id = ${projectId}
    `) as unknown as readonly {
      title: string;
      visibilityScope: string;
      sourceRowVersion: number;
    }[];
    expect(projection).toHaveLength(1);
    expect(projection[0]).toMatchObject({
      title: `Project ${value.project.code}`,
      visibilityScope: "MEMBER",
      sourceRowVersion: 3,
    });

    // 还原不发通知：项目回来看得到，不需要再点一次提醒。
    const notifications = (await client.sql`
      SELECT count(*) AS "count"
        FROM app.notifications
       WHERE project_id = ${projectId}
    `) as unknown as readonly { count: string }[];
    expect(notifications[0]!.count).toBe("0");
  });

  it("还原权限：普通成员 403、非成员与已移除成员 404、未删除 409、系统管理员放行", async () => {
    const value = await fixture();
    const projectId = value.project.projectId;
    const path = `/projects/${projectId}`;
    const member = await actor(false);
    const outsider = await actor(false);
    const removed = await actor(false);
    const admin = await actor(true);
    await join(projectId, member.userId);
    await join(projectId, removed.userId);
    await removeMember(client.sql, projectId, removed.userId);

    // 未删除的项目不能还原：组长与系统管理员都得到 409。
    await expectError(
      await request("POST", `${path}/restore`, value.owner, {
        omitIfMatch: true,
      }),
      409,
      "PROJECT_NOT_DELETED",
    );
    await expectError(
      await request("POST", `${path}/restore`, admin, { omitIfMatch: true }),
      409,
      "PROJECT_NOT_DELETED",
    );

    expect((await request("DELETE", path, value.owner)).status).toBe(204);

    await expectError(
      await request("POST", `${path}/restore`, member, { omitIfMatch: true }),
      403,
      "PROJECT_RESTORE_FORBIDDEN",
    );
    await expectError(
      await request("POST", `${path}/restore`, outsider, { omitIfMatch: true }),
      404,
      "PROJECT_NOT_FOUND",
    );
    await expectError(
      await request("POST", `${path}/restore`, removed, { omitIfMatch: true }),
      404,
      "PROJECT_NOT_FOUND",
    );
    // 不存在的项目与无权访问同样 404，不泄露存在性。
    await expectError(
      await request("POST", "/projects/2147483647/restore", admin, {
        omitIfMatch: true,
      }),
      404,
      "PROJECT_NOT_FOUND",
    );

    // 以上失败都不改动项目行，项目仍是「已删除」。
    expect((await projectRow(projectId)).deletedAt).not.toBeNull();

    // 系统管理员即使不是成员也可以还原。
    expect(
      (await request("POST", `${path}/restore`, admin, { omitIfMatch: true }))
        .status,
    ).toBe(200);
    expect(await projectRow(projectId)).toMatchObject({
      deletedAt: null,
      rowVersion: 3,
    });
  });

  it("重放只按操作者与摘要命中：同 Key 不重复写审计，换 Key 得到 409", async () => {
    const value = await fixture();
    const projectId = value.project.projectId;
    const path = `/projects/${projectId}`;
    const admin = await actor(true);
    const restoreKey = randomUUID();

    expect((await request("DELETE", path, value.owner)).status).toBe(204);

    const first = await request("POST", `${path}/restore`, value.owner, {
      key: restoreKey,
      omitIfMatch: true,
    });
    expect(first.status).toBe(200);
    const firstBody = await first.json();

    // 同 Key、同摘要、同契约版本重放原 200，不再写第二条审计、不再动版本。
    const replay = await request("POST", `${path}/restore`, value.owner, {
      key: restoreKey,
      omitIfMatch: true,
    });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(firstBody);
    expect(await projectRow(projectId)).toMatchObject({ rowVersion: 3 });

    const restores = (await auditReader.sql`
      SELECT count(*) AS "count"
        FROM app.audit_logs
       WHERE project_id = ${projectId}
         AND action = 'project.restore'
    `) as unknown as readonly { count: string }[];
    expect(restores[0]!.count).toBe("1");

    // 换一把新 Key：项目已还原，守卫把它拦成 409。
    await expectError(
      await request("POST", `${path}/restore`, value.owner, {
        omitIfMatch: true,
      }),
      409,
      "PROJECT_NOT_DELETED",
    );

    // 幂等记录按操作者隔离：系统管理员拿着同一把 Key 只是重新执行，同样 409。
    await expectError(
      await request("POST", `${path}/restore`, admin, {
        key: restoreKey,
        omitIfMatch: true,
      }),
      409,
      "PROJECT_NOT_DELETED",
    );
  });

  it("缺 CSRF 422、缺幂等键 400、带请求体 422、未登录 401", async () => {
    const value = await fixture();
    const projectId = value.project.projectId;
    const path = `/projects/${projectId}/restore`;

    expect(
      (await request("DELETE", `/projects/${projectId}`, value.owner)).status,
    ).toBe(204);

    await expectError(
      await request("POST", path, value.owner, {
        omitCsrf: true,
        omitIfMatch: true,
      }),
      422,
      "PROJECT_VALIDATION_FAILED",
    );
    await expectError(
      await request("POST", path, value.owner, {
        omitIdempotency: true,
        omitIfMatch: true,
      }),
      400,
      "IDEMPOTENCY_KEY_REQUIRED",
    );
    await expectError(
      await request("POST", path, value.owner, {
        body: { reason: "误删" },
        contentType: "application/json",
        omitIfMatch: true,
      }),
      422,
      "PROJECT_VALIDATION_FAILED",
    );
    await expectError(
      await request("POST", path, undefined, {
        csrf: "a".repeat(43),
        omitIfMatch: true,
      }),
      401,
      "PROJECT_SESSION_REQUIRED",
    );

    // 失败的还原不改动项目行。
    expect((await projectRow(projectId)).deletedAt).not.toBeNull();
  });
});

describe("ADR-051 项目彻底删除 API", () => {
  it("系统管理员彻底删除：逐表物理删除、SYSTEM 链留一条 project.purge", async () => {
    const value = await fixture();
    const projectId = value.project.projectId;
    const path = `/projects/${projectId}`;
    const admin = await actor(true);
    await seedPurgeableRecords(value.project, value.owner.userId);

    expect((await request("DELETE", path, value.owner)).status).toBe(204);

    // 删除前的行数即 total 的期望值：它必须覆盖全部 27 处删除位置。
    const before = await projectRowCounts(projectId);
    const expectedTotal = Object.values(before).reduce(
      (sum, count) => sum + count,
      0,
    );
    expect(expectedTotal).toBeGreaterThan(0);
    // 夹具确实在这些表里留了行，否则「全表归零」无意义。
    expect(before).toMatchObject({
      modules: 1,
      features: 1,
      tasks: 2,
      task_groups: 1,
      task_group_members: 2,
      change_records: 1,
      project_members: 1,
      audit_logs: 1,
    });

    const purged = await request("POST", `${path}/purge`, admin, {
      omitIfMatch: true,
    });
    expect(purged.status).toBe(200);
    const body = schemaRegistry.ProjectPurgeResponse.schema.parse(
      await purged.json(),
    );
    expect(body.purged).toMatchObject({
      projectId,
      code: value.project.code,
      name: `Project ${value.project.code}`,
      records: {
        modules: before.modules,
        features: before.features,
        tasks: before.tasks,
        changeRecords: before.change_records,
        auditLogs: before.audit_logs,
        members: before.project_members,
        total: expectedTotal,
      },
    });

    // 项目行与它自己的审计链都没了，全部下级数据逐表归零。
    const rows = (await client.sql`
      SELECT count(*) AS "count" FROM app.projects WHERE id = ${projectId}
    `) as unknown as readonly { count: string }[];
    expect(rows[0]!.count).toBe("0");
    expect(await projectRowCounts(projectId)).toEqual(
      Object.fromEntries(ALL_SCOPED_TABLES.map((table) => [table, 0])),
    );

    // 项目动态里的删除行随之消失，删除台账也不再列出。
    const ledgers = await deletions.query({ actorUserId: admin.userId });
    expect(ledgers.items.some((item) => item.projectId === projectId)).toBe(
      false,
    );

    // 唯一保留的记录：SYSTEM 链上的 project.purge（项目链已不存在，只能记在这里）。
    const systemLogs = (await auditReader.sql`
      SELECT project_id AS "projectId",
             actor_id AS "actorId",
             target_id AS "targetId",
             event_payload AS "eventPayload"
        FROM app.audit_logs
       WHERE chain_id = 'SYSTEM'
         AND action = 'project.purge'
         AND target_id = ${String(projectId)}
    `) as unknown as readonly {
      projectId: number | null;
      actorId: number | null;
      targetId: string;
      eventPayload: {
        readonly code: string;
        readonly name: string;
        readonly deletedAt: string;
        readonly deletedBy: { readonly id: number; readonly name: string };
        readonly actorRole: string;
        // 审计正文与响应体共用同一份统计对象，因此两边键名一致。
        readonly records: Readonly<Record<string, number>>;
      };
    }[];
    expect(systemLogs).toHaveLength(1);
    expect(systemLogs[0]).toMatchObject({
      projectId: null,
      actorId: admin.userId,
      targetId: String(projectId),
      eventPayload: {
        code: value.project.code,
        name: `Project ${value.project.code}`,
        deletedBy: { id: value.owner.userId },
        actorRole: "SYSTEM_ADMIN",
        records: {
          modules: body.purged.records.modules,
          features: body.purged.records.features,
          tasks: body.purged.records.tasks,
          changeRecords: body.purged.records.changeRecords,
          auditLogs: body.purged.records.auditLogs,
          members: body.purged.records.members,
          total: body.purged.records.total,
        },
      },
    });
    // 审计正文里的删除时刻是 ISO 字符串，与项目行被软删除的时刻同源。
    const purgedAt = systemLogs[0]!.eventPayload.deletedAt;
    expect(Number.isNaN(Date.parse(purgedAt))).toBe(false);
  });

  it("权限与状态：只有系统管理员，未删除 409、不存在、已删除但非成员同样 403", async () => {
    const value = await fixture();
    const projectId = value.project.projectId;
    const path = `/projects/${projectId}`;
    const member = await actor(false);
    const outsider = await actor(false);
    const admin = await actor(true);
    await join(projectId, member.userId);

    // 未删除的项目不能彻底删除：先过权限门禁的只有系统管理员，得到 409。
    await expectError(
      await request("POST", `${path}/purge`, admin, { omitIfMatch: true }),
      409,
      "PROJECT_NOT_DELETED",
    );

    expect((await request("DELETE", path, value.owner)).status).toBe(204);

    // 反向校验：权限门禁在状态门禁之前，非管理员即使项目已删除也是 403。
    await expectError(
      await request("POST", `${path}/purge`, value.owner, {
        omitIfMatch: true,
      }),
      403,
      "PROJECT_PURGE_FORBIDDEN",
    );
    await expectError(
      await request("POST", `${path}/purge`, member, { omitIfMatch: true }),
      403,
      "PROJECT_PURGE_FORBIDDEN",
    );
    await expectError(
      await request("POST", `${path}/purge`, outsider, { omitIfMatch: true }),
      403,
      "PROJECT_PURGE_FORBIDDEN",
    );
    await expectError(
      await request("POST", "/projects/2147483647/purge", admin, {
        omitIfMatch: true,
      }),
      404,
      "PROJECT_NOT_FOUND",
    );

    // 失败路径不得留下副作用：项目仍在，只是仍是已删除状态。
    expect((await projectRow(projectId)).deletedAt).not.toBeNull();

    expect(
      (await request("POST", `${path}/purge`, admin, { omitIfMatch: true }))
        .status,
    ).toBe(200);
    expect(await projectRowCounts(projectId)).toEqual(
      Object.fromEntries(ALL_SCOPED_TABLES.map((table) => [table, 0])),
    );

    // 彻底删除后同一把 Key 之外的重复调用按不存在处理，不泄露「已被彻底删除」。
    await expectError(
      await request("POST", `${path}/purge`, admin, { omitIfMatch: true }),
      404,
      "PROJECT_NOT_FOUND",
    );
  });

  it("重放按管理员身份复核：同 Key 返回同一份统计，普通成员无法借用", async () => {
    const value = await fixture();
    const projectId = value.project.projectId;
    const path = `/projects/${projectId}`;
    const admin = await actor(true);
    const purgeKey = randomUUID();
    await seedPurgeableRecords(value.project, value.owner.userId);

    expect((await request("DELETE", path, value.owner)).status).toBe(204);

    const first = await request("POST", `${path}/purge`, admin, {
      key: purgeKey,
      omitIfMatch: true,
    });
    expect(first.status).toBe(200);
    const firstBody = await first.json();

    // 项目行已不存在，重放只复核「当前 Session 仍是有效系统管理员」。
    const replay = await request("POST", `${path}/purge`, admin, {
      key: purgeKey,
      omitIfMatch: true,
    });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(firstBody);

    // 幂等记录按操作者隔离：组长拿同一把 Key 只是重新执行，被权限门禁拦下。
    await expectError(
      await request("POST", `${path}/purge`, value.owner, {
        key: purgeKey,
        omitIfMatch: true,
      }),
      403,
      "PROJECT_PURGE_FORBIDDEN",
    );

    const purgeLogs = (await auditReader.sql`
      SELECT count(*) AS "count"
        FROM app.audit_logs
       WHERE chain_id = 'SYSTEM'
         AND action = 'project.purge'
         AND target_id = ${String(projectId)}
    `) as unknown as readonly { count: string }[];
    expect(purgeLogs[0]!.count).toBe("1");
  });
});
