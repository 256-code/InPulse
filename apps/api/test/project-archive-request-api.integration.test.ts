import "reflect-metadata";
import { randomBytes, randomUUID } from "node:crypto";

import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { schemaRegistry } from "@inpulse/api-contract";
import {
  createDatabaseClient,
  type DatabaseClient,
} from "@inpulse/database/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AdminHighRiskAuthService } from "../src/auth/admin-high-risk.service.js";
import { AuthenticatedMutationService } from "../src/auth/authenticated-mutation.service.js";
import { VersionedHmacKeyring } from "../src/auth/keyring.js";
import { PostgresSessionCsrfTokenRepository } from "../src/auth/session-csrf-token.repository.js";
import { SessionAuthService } from "../src/auth/session-auth.service.js";
import { SessionTokenService } from "../src/auth/session-token.service.js";
import { PostgresUserCredentialRepository } from "../src/auth/user-credential.repository.js";
import { PostgresUserSessionRepository } from "../src/auth/user-session.repository.js";
import { PostgresAuditWritePort } from "../src/audit/postgres-audit-write-port.js";
import { PostgresUnitOfWork } from "../src/database/unit-of-work.js";
import { ApiExceptionFilter } from "../src/http/api-exception.filter.js";
import { ContractResponseInterceptor } from "../src/http/contract-response.interceptor.js";
import { IdempotencyHttpService } from "../src/idempotency/http-service.js";
import { IdempotencyRunner } from "../src/idempotency/runner.js";
import { resolveRegisteredRoute } from "../src/idempotency/route.js";
import { PostgresIdempotencyStore } from "../src/idempotency/store.js";
import { PostgresActivityWritePort } from "../src/modules/activity/postgres-activity-write-port.js";
import { PostgresNotificationWritePort } from "../src/modules/notifications/postgres-notification-write-port.js";
import { PostgresProjectAccessQueryPort } from "../src/modules/projects/postgres-project-access-query-port.js";
import { PostgresProjectArchiveRequestRepository } from "../src/modules/projects/postgres-project-archive-request.repository.js";
import { PostgresProjectMembersQueryPort } from "../src/modules/projects/postgres-project-members-query-port.js";
import { PostgresProjectQueryPort } from "../src/modules/projects/postgres-project-query-port.js";
import { PostgresProjectsWritePort } from "../src/modules/projects/postgres-projects-write-port.js";
import { ProjectArchiveRequestController } from "../src/modules/projects/project-archive-request.controller.js";
import { ProjectArchiveRequestHttpService } from "../src/modules/projects/project-archive-request-http.service.js";
import { ProjectArchiveRequestService } from "../src/modules/projects/project-archive-request.service.js";
import { ProjectRoleGateService } from "../src/modules/projects/project-role-gate.service.js";
import { ProjectsReadController } from "../src/modules/projects/projects-read.controller.js";
import { ProjectsReadService } from "../src/modules/projects/projects-read.service.js";
import { PostgresSearchProjectionWritePort } from "../src/modules/search/postgres-search-projection-write-port.js";
import {
  createProject,
  createUser,
  testUrls,
  type ProjectFixture,
} from "./database.helpers.js";

const auditKey = Buffer.alloc(32, 0x7a);

let client: DatabaseClient;
let auditReader: DatabaseClient;
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

interface Fixture {
  readonly admin: Actor;
  readonly leader: Actor;
  readonly member: Actor;
  readonly outsider: Actor;
  readonly project: ProjectFixture;
}

/** 项目创建者由夹具插入为 LEADER；再补一名普通成员与一名非成员。 */
async function fixture(): Promise<Fixture> {
  const admin = await actor(true);
  const leader = await actor(false);
  const member = await actor(false);
  const outsider = await actor(false);
  const project = await createProject(client.sql, leader.userId);
  await client.sql`
    INSERT INTO app.project_members (project_id, user_id, role)
    VALUES (${project.projectId}, ${member.userId}, 'MEMBER')
  `;
  return { admin, leader, member, outsider, project };
}

async function seedTask(
  project: ProjectFixture,
  assigneeId: number,
  code: string,
): Promise<number> {
  return client.sql.begin(async (tx) => {
    const rows = (await tx`
    INSERT INTO app.tasks (
      project_id, module_id, scope_type, code, title, assignee_id, creator_id
    )
    VALUES (
      ${project.projectId},
      ${project.moduleId},
      'MODULE',
      ${code},
      '未归档任务',
      ${assigneeId},
      ${assigneeId}
    )
    RETURNING id
  `) as unknown as readonly { id: number }[];
    const taskId = rows[0]!.id;
    await tx`
      INSERT INTO app.task_status_history (
        task_id, project_id, from_work_status, to_work_status, changed_by
      ) VALUES (${taskId}, ${project.projectId}, NULL, 'TODO', ${assigneeId})
    `;
    return taskId;
  });
}

async function setTaskLifecycle(
  taskId: number,
  lifecycle: "ACTIVE" | "ARCHIVED",
): Promise<void> {
  await client.sql`
    UPDATE app.tasks
       SET lifecycle_status = ${lifecycle},
           row_version = row_version + 1
     WHERE id = ${taskId}
  `;
}

async function request(
  method: string,
  path: string,
  who?: Actor,
  body?: unknown,
  options: { readonly key?: string; readonly ifMatch?: string } = {},
): Promise<Response> {
  const write = method !== "GET";
  const headers: Record<string, string> = {
    origin: base,
    "sec-fetch-site": "same-origin",
    ...(who === undefined ? {} : { cookie: who.cookie }),
    ...(write
      ? {
          "x-csrf-token": who?.csrf ?? "",
          "content-type": "application/json",
          "Idempotency-Key": options.key ?? randomUUID(),
          ...(options.ifMatch === undefined
            ? {}
            : { "if-match": options.ifMatch }),
        }
      : {}),
  };
  return fetch(`${base}/api/v1${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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

async function readItem(response: Response) {
  if (response.status !== 200) {
    throw new Error(
      "unexpected status " + response.status + " " + (await response.text()),
    );
  }
  return schemaRegistry.ProjectArchiveRequestItem.schema.parse(
    await response.json(),
  );
}

async function notificationRows(projectId: number, type: string) {
  return (await client.sql`
    SELECT recipient_id AS "recipientId",
           notification_type AS "notificationType",
           target_path AS "targetPath"
      FROM app.notifications
     WHERE project_id = ${projectId}
       AND notification_type = ${type}
  `) as unknown as readonly {
    recipientId: number;
    notificationType: string;
    targetPath: string;
  }[];
}

beforeAll(async () => {
  client = createDatabaseClient(testUrls().runtime, {
    applicationName: "inpulse-f06-2-archive-request",
  });
  auditReader = createDatabaseClient(testUrls().auditReader, {
    applicationName: "inpulse-f06-2-archive-request-audit",
  });
  const uow = new PostgresUnitOfWork(client);
  const csrf = new PostgresSessionCsrfTokenRepository();
  const sessions = new PostgresUserSessionRepository();
  const auth = new SessionAuthService(uow, sessions, tokens);
  const access = new PostgresProjectAccessQueryPort(client);
  const members = new PostgresProjectMembersQueryPort();
  const service = new ProjectArchiveRequestService(
    new PostgresProjectsWritePort(),
    new PostgresProjectArchiveRequestRepository(),
    access,
    new ProjectRoleGateService(access, members),
    members,
    new PostgresAuditWritePort({ currentVersion: 1, keyFor: () => auditKey }),
    new PostgresActivityWritePort(),
    new PostgresSearchProjectionWritePort(),
    new PostgresNotificationWritePort(),
  );
  const http = new ProjectArchiveRequestHttpService(
    new AuthenticatedMutationService(auth, csrf, tokens),
    new AdminHighRiskAuthService(
      sessions,
      csrf,
      tokens,
      new PostgresUserCredentialRepository(),
    ),
    new IdempotencyHttpService(
      new IdempotencyRunner(uow, new PostgresIdempotencyStore()),
      { currentVersion: 1, currentKey: () => key, keyFor: () => key },
      resolveRegisteredRoute,
    ),
    service,
  );
  const reads = new ProjectsReadService(
    auth,
    access,
    new PostgresProjectQueryPort(client),
  );

  class TestModule {}
  Module({
    controllers: [ProjectArchiveRequestController, ProjectsReadController],
    providers: [
      { provide: ProjectArchiveRequestHttpService, useValue: http },
      { provide: ProjectsReadService, useValue: reads },
    ],
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

describe("F-06.2 项目归档申请 API（ADR-034）", () => {
  it("accepts the request once every task is finished without archiving", async () => {
    const value = await fixture();
    const path = "/projects/" + value.project.projectId + "/archive-requests";
    // ADR-034：任务完成（work_status = DONE）即视为已收尾，不再阻塞归档申请。
    await client.sql`
      WITH created AS (
        INSERT INTO app.tasks (
          project_id, module_id, scope_type, code, title, assignee_id, creator_id,
          work_status, completed_at
        )
        VALUES (
          ${value.project.projectId},
          ${value.project.moduleId},
          'MODULE',
          ${value.project.code + "-T-1"},
          '已完成任务',
          ${value.leader.userId},
          ${value.leader.userId},
          'DONE',
          now()
        )
        RETURNING id, project_id, completed_at
      )
      INSERT INTO app.task_status_history (
        task_id, project_id, from_work_status, to_work_status,
        completed_at_snapshot, changed_by
      )
      SELECT id, project_id, NULL, 'DONE', completed_at, ${value.leader.userId}
        FROM created
    `;

    const submitted = await request("POST", path, value.leader, {
      reason: "任务全部完成",
    });
    expect(submitted.status, await submitted.clone().text()).toBe(200);
  });

  it("blocks open tasks for every active member, then lets a leader submit and replay", async () => {
    const value = await fixture();
    const taskId = await seedTask(
      value.project,
      value.leader.userId,
      value.project.code + "-T-1",
    );
    const path = "/projects/" + value.project.projectId + "/archive-requests";

    // ADR-039：提交归档申请不再要求组长，普通成员也能穿过角色门；
    // 此处仍因存在未归档任务而 409，证明拒绝理由已不再是权限。
    await expectError(
      await request("POST", path, value.member, { reason: "阶段性收尾" }),
      409,
      "PROJECT_ARCHIVE_TASKS_OPEN",
    );
    await expectError(
      await request("POST", path, value.outsider, { reason: "阶段性收尾" }),
      404,
      "PROJECT_NOT_FOUND",
    );
    await expectError(
      await request("POST", path, value.leader, { reason: "阶段性收尾" }),
      409,
      "PROJECT_ARCHIVE_TASKS_OPEN",
    );

    await setTaskLifecycle(taskId, "ARCHIVED");

    const submitKey = randomUUID();
    const submitted = await request(
      "POST",
      path,
      value.leader,
      { reason: "阶段性收尾" },
      { key: submitKey },
    );
    expect(submitted.status).toBe(200);
    const created = await readItem(submitted);
    expect(created).toMatchObject({
      projectId: value.project.projectId,
      requestedBy: value.leader.userId,
      reason: "阶段性收尾",
      status: "PENDING",
      decidedBy: null,
    });

    await expectError(
      await request("POST", path, value.leader, { reason: "重复申请" }),
      409,
      "PROJECT_ARCHIVE_REQUEST_EXISTS",
    );

    const replay = await request(
      "POST",
      path,
      value.leader,
      { reason: "阶段性收尾" },
      { key: submitKey },
    );
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(created);

    const audits = (await auditReader.sql`
      SELECT action, target_id AS "targetId"
        FROM app.audit_logs
       WHERE project_id = ${value.project.projectId}
         AND action = 'project.archive.request'
    `) as unknown as readonly { action: string; targetId: string }[];
    expect(audits).toHaveLength(1);

    const activities = (await client.sql`
      SELECT activity_type AS "activityType"
        FROM app.activity_projection
       WHERE project_id = ${value.project.projectId}
         AND activity_type = 'PROJECT_ARCHIVE_REQUESTED'
    `) as unknown as readonly { activityType: string }[];
    expect(activities).toHaveLength(1);

    const notifications = await notificationRows(
      value.project.projectId,
      "PROJECT_ARCHIVE_REQUESTED",
    );
    expect(notifications.map((row) => row.recipientId)).toContain(
      value.admin.userId,
    );
    expect(notifications[0]!.targetPath).toBe("/projects");

    const list = await request("GET", "/projects", value.leader);
    expect(list.status).toBe(200);
    const page = schemaRegistry.ProjectListResponse.schema.parse(
      await list.json(),
    );
    const item = page.items.find(
      (entry) => entry.id === value.project.projectId,
    );
    expect(item).toMatchObject({ currentUserRole: "LEADER" });
    expect(item?.pendingArchiveRequest).toMatchObject({
      requestedBy: value.leader.userId,
      reason: "阶段性收尾",
    });

    const memberList = await request("GET", "/projects", value.member);
    const memberPage = schemaRegistry.ProjectListResponse.schema.parse(
      await memberList.json(),
    );
    expect(
      memberPage.items.find((entry) => entry.id === value.project.projectId)
        ?.currentUserRole,
    ).toBe("MEMBER");
  });

  it("only system administrators can review, and rejection keeps the project active", async () => {
    const value = await fixture();
    const path = "/projects/" + value.project.projectId + "/archive-requests";
    const submitted = await request("POST", path, value.leader, {
      reason: "交付结束",
    });
    const created = await readItem(submitted);
    const decidePath = path + "/" + created.id + "/reject";

    await expectError(
      await request("POST", decidePath, value.member, { note: "不同意" }),
      403,
      "ADMIN_REQUIRED",
    );
    // 审核路由先校验全局管理员身份，非管理员即使不是项目成员也返回 403。
    await expectError(
      await request("POST", decidePath, value.outsider, { note: "不同意" }),
      403,
      "ADMIN_REQUIRED",
    );
    await expectError(
      await request(
        "POST",
        "/projects/2147483000/archive-requests/1/reject",
        value.admin,
        { note: "不同意" },
      ),
      404,
      "PROJECT_NOT_FOUND",
    );
    await expectError(
      await request("POST", decidePath, value.leader, { note: "不同意" }),
      403,
      "ADMIN_REQUIRED",
    );

    const rejected = await request("POST", decidePath, value.admin, {
      note: "任务尚未收尾",
    });
    expect(rejected.status).toBe(200);
    const item = schemaRegistry.ProjectArchiveRequestItem.schema.parse(
      await rejected.json(),
    );
    expect(item).toMatchObject({
      status: "REJECTED",
      decidedBy: value.admin.userId,
      decisionNote: "任务尚未收尾",
    });

    const projectRows = (await client.sql`
      SELECT status, row_version AS "rowVersion"
        FROM app.projects
       WHERE id = ${value.project.projectId}
    `) as unknown as readonly { status: string; rowVersion: number }[];
    expect(projectRows[0]).toMatchObject({
      status: "NOT_STARTED",
      rowVersion: 1,
    });

    const notifications = await notificationRows(
      value.project.projectId,
      "PROJECT_ARCHIVE_REJECTED",
    );
    expect(notifications.map((row) => row.recipientId)).toEqual([
      value.leader.userId,
    ]);

    await expectError(
      await request("POST", decidePath, value.admin, { note: "再次驳回" }),
      409,
      "PROJECT_ARCHIVE_REQUEST_DECIDED",
    );
  });

  it("approves with If-Match, archives the project and notifies the requester", async () => {
    const value = await fixture();
    const path = "/projects/" + value.project.projectId + "/archive-requests";
    const submitted = await request("POST", path, value.leader, {
      reason: "本阶段交付结束",
    });
    const created = await readItem(submitted);
    const approvePath = path + "/" + created.id + "/approve";

    await expectError(
      await request("POST", approvePath, value.admin, undefined, {
        ifMatch: '"99"',
      }),
      409,
      "PROJECT_VERSION_CONFLICT",
    );
    await expectError(
      await request("POST", approvePath, value.leader, undefined, {
        ifMatch: '"1"',
      }),
      403,
      "ADMIN_REQUIRED",
    );

    const approved = await request(
      "POST",
      approvePath,
      value.admin,
      undefined,
      {
        ifMatch: '"1"',
      },
    );
    expect(approved.status).toBe(200);
    const detail = schemaRegistry.ProjectDetailResponse.schema.parse(
      await approved.json(),
    );
    expect(detail.project).toMatchObject({
      id: value.project.projectId,
      status: "ARCHIVED",
      rowVersion: 2,
    });

    const requestRows = (await client.sql`
      SELECT status, decided_by AS "decidedBy"
        FROM app.project_archive_requests
       WHERE id = ${created.id}
    `) as unknown as readonly { status: string; decidedBy: number }[];
    expect(requestRows[0]).toMatchObject({
      status: "APPROVED",
      decidedBy: value.admin.userId,
    });

    const audits = (await auditReader.sql`
      SELECT action
        FROM app.audit_logs
       WHERE project_id = ${value.project.projectId}
         AND action = 'project.archive'
    `) as unknown as readonly { action: string }[];
    expect(audits).toHaveLength(1);

    const notifications = await notificationRows(
      value.project.projectId,
      "PROJECT_ARCHIVE_APPROVED",
    );
    expect(notifications.map((row) => row.recipientId)).toEqual([
      value.leader.userId,
    ]);

    // 项目已归档，重复批准在版本匹配后先命中项目状态门禁。
    await expectError(
      await request("POST", approvePath, value.admin, undefined, {
        ifMatch: '"2"',
      }),
      409,
      "PROJECT_STATE_CONFLICT",
    );
  });
});
