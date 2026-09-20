import "reflect-metadata";
import { randomBytes } from "node:crypto";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  createDatabaseClient,
  type DatabaseClient,
} from "@inpulse/database/client";
import { schemaRegistry } from "@inpulse/api-contract";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ApiExceptionFilter } from "../src/http/api-exception.filter.js";
import { ContractResponseInterceptor } from "../src/http/contract-response.interceptor.js";
import { VersionedHmacKeyring } from "../src/auth/keyring.js";
import { SessionAuthService } from "../src/auth/session-auth.service.js";
import { SessionTokenService } from "../src/auth/session-token.service.js";
import { generateOpaqueToken } from "../src/auth/token.js";
import { PostgresUserSessionRepository } from "../src/auth/user-session.repository.js";
import { PostgresUnitOfWork } from "../src/database/unit-of-work.js";
import { PostgresProjectAccessQueryPort } from "../src/modules/projects/postgres-project-access-query-port.js";
import { PostgresProjectQueryPort } from "../src/modules/projects/postgres-project-query-port.js";
import { ProjectsReadController } from "../src/modules/projects/projects-read.controller.js";
import { ProjectsReadService } from "../src/modules/projects/projects-read.service.js";
import { TaskManagementRepository } from "../src/modules/tasks/task-management.repository.js";
import {
  createProject,
  createUser,
  removeMember,
  testUrls,
} from "./database.helpers.js";

let client: DatabaseClient;
let app: INestApplication | undefined;
let base: string;
let tokenService: SessionTokenService;
let uow: PostgresUnitOfWork;
const taskWrites = new TaskManagementRepository();

/** 项目统计夹具的期望值：与 R-2 getProjectOverview 同口径。 */
const expectedStats = {
  activeModuleCount: 2,
  activeFeatureCount: 2,
  openTaskCount: 4,
  // 统计夹具里只有「统计夹具已完成任务」一条 DONE（历史来源分支不计）。
  completedTaskCount: 1,
} as const;

async function issueSessionCookie(userId: number): Promise<string> {
  const token = generateOpaqueToken();
  const tokenHash = tokenService.hash(token).hash;
  await client.sql`
    INSERT INTO app.user_sessions (
      user_id,
      token_hash,
      token_hash_key_version,
      auth_version_at_issue,
      auth_state,
      recovery_rotation_generation,
      recovery_rotation_consumed_generation,
      created_at,
      last_seen_at,
      idle_expires_at,
      absolute_expires_at
    )
    VALUES (
      ${userId},
      ${tokenHash},
      1,
      1,
      'AUTHENTICATED',
      0,
      0,
      now(),
      now(),
      now() + interval '1 hour',
      now() + interval '1 day'
    )
  `;
  return `__Host-session=${token}`;
}

async function actor(
  admin = false,
): Promise<{ userId: number; cookie: string }> {
  const userId = await createUser(client.sql, { admin });
  return { userId, cookie: await issueSessionCookie(userId) };
}

async function list(cookie?: string): Promise<Response> {
  return fetch(`${base}/api/v1/projects`, {
    headers: cookie === undefined ? {} : { cookie },
  });
}

async function detail(
  projectId: number | string,
  cookie?: string,
): Promise<Response> {
  return fetch(`${base}/api/v1/projects/${projectId}`, {
    headers: cookie === undefined ? {} : { cookie },
  });
}

async function errorBody(
  response: Response,
  status: number,
  code: string,
): Promise<void> {
  expect(response.status).toBe(status);
  const body = schemaRegistry.ErrorResponse.schema.parse(await response.json());
  expect(body.code).toBe(code);
}

beforeAll(async () => {
  client = createDatabaseClient(testUrls().runtime, {
    applicationName: "inpulse-projects-read-api-test",
  });
  const uowLocal = new PostgresUnitOfWork(client);
  uow = uowLocal;
  const keyring = VersionedHmacKeyring.fromEntries(
    [{ version: 1, key: randomBytes(32) }],
    1,
  );
  tokenService = new SessionTokenService(keyring);
  const auth = new SessionAuthService(
    uow,
    new PostgresUserSessionRepository(),
    tokenService,
  );
  const service = new ProjectsReadService(
    auth,
    new PostgresProjectAccessQueryPort(client),
    new PostgresProjectQueryPort(client),
  );

  class TestModule {}
  Module({
    controllers: [ProjectsReadController],
    providers: [{ provide: ProjectsReadService, useValue: service }],
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
});

describe("F-05.1 real HTTP + PostgreSQL", () => {
  test("系统管理员列表包含全部项目，成员列表只含自己的项目且归档仍可读", async () => {
    const admin = await actor(true);
    const member = await actor();
    const owner = await actor();
    const memberProject = await createProject(client.sql, member.userId);
    const ownerProject = await createProject(client.sql, owner.userId);
    const extraMember = await actor();
    await client.sql`
      INSERT INTO app.project_members (project_id, user_id)
      VALUES (${memberProject.projectId}, ${extraMember.userId})
    `;

    const adminList = await list(admin.cookie);
    expect(adminList.status).toBe(200);
    expect(adminList.headers.get("cache-control")).toBe("no-store");
    const adminItems = schemaRegistry.ProjectListResponse.schema.parse(
      await adminList.json(),
    ).items;
    expect(adminItems.some((item) => item.id === memberProject.projectId)).toBe(
      true,
    );
    expect(adminItems.some((item) => item.id === ownerProject.projectId)).toBe(
      true,
    );

    const memberList = await list(member.cookie);
    expect(memberList.status).toBe(200);
    const memberItems = schemaRegistry.ProjectListResponse.schema.parse(
      await memberList.json(),
    ).items;
    expect(memberItems.map((item) => item.id)).toContain(
      memberProject.projectId,
    );
    expect(memberItems.map((item) => item.id)).not.toContain(
      ownerProject.projectId,
    );
    const memberProjectItem = memberItems.find(
      (item) => item.id === memberProject.projectId,
    );
    expect(memberProjectItem).toMatchObject({
      status: "NOT_STARTED",
      memberCount: 2,
    });

    await client.sql`
      UPDATE app.projects
         SET status = 'ARCHIVED',
             archived_at = now(),
             row_version = row_version + 1
       WHERE id = ${memberProject.projectId}
    `;
    const archivedDetail = await detail(memberProject.projectId, member.cookie);
    expect(archivedDetail.status).toBe(200);
    expect(
      schemaRegistry.ProjectDetailResponse.schema.parse(
        await archivedDetail.json(),
      ).project.status,
    ).toBe("ARCHIVED");
  });

  test("非成员、移除、匿名、停用和非法路径分别安全返回 404/401/422", async () => {
    const member = await actor();
    const other = await actor();
    const removed = await actor();
    const disabled = await actor();
    const project = await createProject(client.sql, member.userId);
    const otherProject = await createProject(client.sql, other.userId);
    await client.sql`
      INSERT INTO app.project_members (project_id, user_id)
      VALUES (${project.projectId}, ${removed.userId})
    `;
    await removeMember(client.sql, project.projectId, removed.userId);
    await client.sql`
      INSERT INTO app.project_members (project_id, user_id)
      VALUES (${project.projectId}, ${disabled.userId})
    `;
    await client.sql`
      UPDATE app.users
         SET status = 'DISABLED',
             disabled_at = now(),
             row_version = row_version + 1
       WHERE id = ${disabled.userId}
    `;

    expect((await detail(project.projectId, member.cookie)).status).toBe(200);
    await errorBody(
      await detail(project.projectId, other.cookie),
      404,
      "PROJECT_NOT_FOUND",
    );
    await errorBody(
      await detail(project.projectId, removed.cookie),
      404,
      "PROJECT_NOT_FOUND",
    );
    await errorBody(
      await detail(project.projectId),
      401,
      "PROJECT_SESSION_REQUIRED",
    );
    await errorBody(
      await detail(project.projectId, disabled.cookie),
      401,
      "PROJECT_SESSION_REQUIRED",
    );
    await errorBody(
      await detail("not-a-number", member.cookie),
      422,
      "VALIDATION_FAILED",
    );
    await errorBody(
      await detail(999999999, member.cookie),
      404,
      "PROJECT_NOT_FOUND",
    );

    const memberList = await list(member.cookie);
    const memberItems = schemaRegistry.ProjectListResponse.schema.parse(
      await memberList.json(),
    ).items;
    expect(memberItems.map((item) => item.id)).not.toContain(
      otherProject.projectId,
    );
  });

  test("列表与详情按 R-2 口径返回活跃模块、活跃功能与未完成有效任务", async () => {
    const admin = await actor(true);
    const owner = await actor();
    const extra = await actor();
    const project = await createProject(client.sql, owner.userId);
    await client.sql`
      INSERT INTO app.project_members (project_id, user_id)
      VALUES (${project.projectId}, ${extra.userId})
    `;
    const [secondModule] = await client.sql<{ id: number }[]>`
      INSERT INTO app.modules (project_id, name, created_by)
      VALUES (${project.projectId}, ${"统计夹具模块 B"}, ${owner.userId})
      RETURNING id
    `;
    await client.sql`
      INSERT INTO app.modules (project_id, name, created_by, status, archived_at)
      VALUES (
        ${project.projectId},
        ${"统计夹具模块 C"},
        ${owner.userId},
        ${"ARCHIVED"},
        clock_timestamp()
      )
    `;
    for (const [code, name, moduleId, status] of [
      [`${project.code}-F-1`, "统计夹具功能 1", project.moduleId, "ACTIVE"],
      [`${project.code}-F-2`, "统计夹具功能 2", secondModule!.id, "ACTIVE"],
      [`${project.code}-F-3`, "统计夹具功能 3", project.moduleId, "ARCHIVED"],
    ] as const) {
      await client.sql`
        INSERT INTO app.features (
          project_id, module_id, code, name, created_by, status, archived_at
        )
        VALUES (
          ${project.projectId},
          ${moduleId},
          ${code},
          ${name},
          ${owner.userId},
          ${status},
          ${status === "ARCHIVED" ? new Date().toISOString() : null}::timestamptz
        )
      `;
    }

    let taskSequence = 0;
    const newTask = async (title: string) => {
      taskSequence += 1;
      return uow.run((tx) =>
        taskWrites.create(
          tx,
          {
            projectId: project.projectId,
            moduleId: project.moduleId,
            featureId: null,
          },
          owner.userId,
          `${project.code}-T-${taskSequence}`,
          {
            title,
            description: "",
            assigneeId: owner.userId,
            priority: "NORMAL",
            dueAt: null,
          },
        ),
      );
    };

    await newTask("统计夹具未完成任务");
    const done = await newTask("统计夹具已完成任务");
    await uow.run((tx) =>
      taskWrites.transition(
        tx,
        done,
        owner.userId,
        "DONE",
        "统计夹具完成",
        null,
      ),
    );
    const canceled = await newTask("统计夹具已取消任务");
    await uow.run((tx) =>
      taskWrites.transition(
        tx,
        canceled,
        owner.userId,
        "CANCELED",
        null,
        "统计夹具取消",
      ),
    );
    const invalid = await newTask("统计夹具已失效任务");
    await client.sql`
      UPDATE app.tasks
         SET lifecycle_status = ${"INVALID"},
             updated_at = clock_timestamp(),
             row_version = row_version + 1
       WHERE id = ${invalid.id} AND project_id = ${project.projectId}
    `;
    const historicalSource = await newTask("统计夹具历史来源任务");
    const activeSource = await newTask("统计夹具聚合来源任务");
    const activeGroupMain = await newTask("统计夹具活跃组主任务");
    const closedGroupSource = await newTask("统计夹具已关闭组来源任务");

    await uow.run(async (tx) => {
      const [activeGroup] = await tx.sql<{ id: number }[]>`
        INSERT INTO app.task_groups (project_id, code, name, created_by, status)
        VALUES (
          ${project.projectId},
          ${`${project.code}-TG-1`},
          ${"统计夹具活跃聚合组"},
          ${owner.userId},
          ${"ACTIVE"}
        )
        RETURNING id
      `;
      await tx.sql`
        INSERT INTO app.task_group_members (group_id, task_id, project_id, role, status, joined_at)
        VALUES (${activeGroup!.id}, ${activeGroupMain.id}, ${project.projectId}, ${"MAIN"}, ${"ACTIVE"}, clock_timestamp())
      `;
      await tx.sql`
        INSERT INTO app.task_group_members (
          group_id, task_id, project_id, role, source_kind, original_work_status,
          original_assignee_id, status, joined_at
        )
        VALUES (
          ${activeGroup!.id}, ${historicalSource.id}, ${project.projectId}, ${"SOURCE"},
          ${"HISTORICAL"}, ${"DONE"}, ${owner.userId}, ${"ACTIVE"}, clock_timestamp()
        )
      `;
      await tx.sql`
        INSERT INTO app.task_group_members (
          group_id, task_id, project_id, role, source_kind, original_work_status,
          original_assignee_id, status, joined_at
        )
        VALUES (
          ${activeGroup!.id}, ${activeSource.id}, ${project.projectId}, ${"SOURCE"},
          ${"ACTIVE"}, ${"TODO"}, ${owner.userId}, ${"ACTIVE"}, clock_timestamp()
        )
      `;

      const [closedGroup] = await tx.sql<{ id: number }[]>`
        INSERT INTO app.task_groups (project_id, code, name, created_by, status, closed_at)
        VALUES (
          ${project.projectId},
          ${`${project.code}-TG-2`},
          ${"统计夹具已关闭聚合组"},
          ${owner.userId},
          ${"CLOSED"},
          clock_timestamp()
        )
        RETURNING id
      `;
      await tx.sql`
        INSERT INTO app.task_group_members (
          group_id, task_id, project_id, role, source_kind, original_work_status,
          original_assignee_id, status, joined_at, detached_at, detached_by, detach_reason
        )
        VALUES (
          ${closedGroup!.id}, ${closedGroupSource.id}, ${project.projectId}, ${"SOURCE"},
          ${"HISTORICAL"}, ${"TODO"}, ${owner.userId}, ${"DETACHED"},
          clock_timestamp() - interval '1 hour', clock_timestamp(), ${owner.userId},
          ${"统计夹具解除关联"}
        )
      `;
    });

    const isolated = await createProject(client.sql, owner.userId);
    const detailBody = schemaRegistry.ProjectDetailResponse.schema.parse(
      await (await detail(project.projectId, admin.cookie)).json(),
    );
    expect(detailBody.project.stats).toEqual(expectedStats);

    const items = schemaRegistry.ProjectListResponse.schema.parse(
      await (await list(owner.cookie)).json(),
    ).items;
    expect(items.find((item) => item.id === project.projectId)?.stats).toEqual(
      expectedStats,
    );
    expect(items.find((item) => item.id === isolated.projectId)?.stats).toEqual(
      {
        activeModuleCount: 1,
        activeFeatureCount: 0,
        openTaskCount: 0,
        completedTaskCount: 0,
      },
    );
    expect(
      items.find((item) => item.id === project.projectId)?.memberCount,
    ).toBe(2);
  });

  test("列表按生命周期档位排序：进行中、未开始、维护中、已归档", async () => {
    const owner = await actor();
    const active = await createProject(client.sql, owner.userId);
    const notStarted = await createProject(client.sql, owner.userId);
    const maintenance = await createProject(client.sql, owner.userId);
    const archived = await createProject(client.sql, owner.userId);

    await client.sql`
      WITH created AS (
        INSERT INTO app.tasks (
          project_id, module_id, scope_type, code, title, work_status,
          completion_note, completed_at, assignee_id, creator_id
        )
        VALUES (
          ${active.projectId},
          ${active.moduleId},
          'MODULE',
          ${`${active.code}-T-1`},
          '已完成任务',
          'DONE',
          '已完成',
          now(),
          ${owner.userId},
          ${owner.userId}
        )
        RETURNING id, project_id
      )
      INSERT INTO app.task_status_history (
        task_id, project_id, from_work_status, to_work_status,
        completed_at_snapshot, completion_note_snapshot, changed_by
      )
      SELECT id, project_id, NULL, 'DONE', now(), '已完成', ${owner.userId}
        FROM created
    `;
    // ADR-035：任务完成才让项目升级为进行中；夹具直接写库，这里手动补状态与粘性标记。
    await client.sql`
      UPDATE app.projects
         SET status = 'ACTIVE',
             first_task_completed_at = now(),
             row_version = row_version + 1
       WHERE id = ${active.projectId}
    `;
    await client.sql`
      UPDATE app.projects
         SET status = 'MAINTENANCE',
             row_version = row_version + 1
       WHERE id = ${maintenance.projectId}
    `;
    await client.sql`
      UPDATE app.projects
         SET status = 'ARCHIVED',
             archived_at = now(),
             row_version = row_version + 1
       WHERE id = ${archived.projectId}
    `;

    const items = schemaRegistry.ProjectListResponse.schema.parse(
      await (await list(owner.cookie)).json(),
    ).items;
    expect(items.map((item) => item.id)).toEqual([
      active.projectId,
      notStarted.projectId,
      maintenance.projectId,
      archived.projectId,
    ]);
    expect(items.map((item) => item.stats.completedTaskCount)).toEqual([
      1, 0, 0, 0,
    ]);
  });
});
