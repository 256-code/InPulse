import "reflect-metadata";
import { randomBytes, randomUUID } from "node:crypto";

import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { schemaRegistry } from "@inpulse/api-contract";
import {
  createDatabaseClient,
  type DatabaseClient,
} from "@inpulse/database/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { AuthenticatedMutationService } from "../src/auth/authenticated-mutation.service.js";
import { VersionedHmacKeyring } from "../src/auth/keyring.js";
import { SessionAuthService } from "../src/auth/session-auth.service.js";
import { PostgresSessionCsrfTokenRepository } from "../src/auth/session-csrf-token.repository.js";
import { SessionTokenService } from "../src/auth/session-token.service.js";
import { PostgresUserSessionRepository } from "../src/auth/user-session.repository.js";
import { PostgresAuditWritePort } from "../src/audit/postgres-audit-write-port.js";
import { PostgresUnitOfWork } from "../src/database/unit-of-work.js";
import { PostgresIdempotencyStore } from "../src/idempotency/store.js";
import { IdempotencyHttpService } from "../src/idempotency/http-service.js";
import { IdempotencyRunner } from "../src/idempotency/runner.js";
import { resolveRegisteredRoute } from "../src/idempotency/route.js";
import { ApiExceptionFilter } from "../src/http/api-exception.filter.js";
import { ContractResponseInterceptor } from "../src/http/contract-response.interceptor.js";
import { PostgresFeatureQueryPort } from "../src/modules/features/postgres-feature-query-port.js";
import { PostgresFeatureReadPort } from "../src/modules/features/postgres-feature-read-port.js";
import { PostgresModuleQueryPort } from "../src/modules/modules/postgres-module-query-port.js";
import { PostgresModuleReadPort } from "../src/modules/modules/postgres-module-read-port.js";
import { PostgresActivityWritePort } from "../src/modules/activity/postgres-activity-write-port.js";
import { PostgresNotificationWritePort } from "../src/modules/notifications/postgres-notification-write-port.js";
import { PostgresProjectAccessQueryPort } from "../src/modules/projects/postgres-project-access-query-port.js";
import { PostgresProjectCodePort } from "../src/modules/projects/postgres-project-code-port.js";
import { PostgresProjectMembersQueryPort } from "../src/modules/projects/postgres-project-members-query-port.js";
import { ProjectRoleGateService } from "../src/modules/projects/project-role-gate.service.js";
import {
  PostgresActiveUsersQueryPort,
  PostgresProjectsWritePort,
} from "../src/modules/projects/postgres-projects-write-port.js";
import { ProjectMemberManagementController } from "../src/modules/projects/project-member-management.controller.js";
import { ProjectMemberManagementHttpService } from "../src/modules/projects/project-member-management-http.service.js";
import { ProjectMemberManagementService } from "../src/modules/projects/project-member-management.service.js";
import { PostgresSearchProjectionWritePort } from "../src/modules/search/postgres-search-projection-write-port.js";
import { ProjectMemberTaskCommandPort } from "../src/modules/tasks/project-member-task.command-port.js";
import { TaskManagementRepository } from "../src/modules/tasks/task-management.repository.js";
import { TasksManagementService } from "../src/modules/tasks/tasks-management.service.js";
import {
  createProject,
  createUser,
  testUrls,
  type ProjectFixture,
} from "./database.helpers.js";

let client: DatabaseClient;
let auditReader: DatabaseClient;
let app: INestApplication | undefined;
let base: string;
let uow: PostgresUnitOfWork;
let audit: PostgresAuditWritePort;
let management: TasksManagementService;
let memberService: ProjectMemberManagementService;

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
  readonly admin: Actor;
  readonly owner: Actor;
  readonly project: ProjectFixture;
  readonly featureId: number;
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
  return {
    userId,
    cookie: `__Host-session=${cookie}`,
    csrf,
  };
}

async function fixture(): Promise<Fixture> {
  const admin = await actor(true);
  const owner = await actor(false);
  const project = await createProject(client.sql, owner.userId);
  const [feature] = await client.sql<Array<{ id: number }>>`
    INSERT INTO app.features (project_id, module_id, code, name, created_by)
    VALUES (
      ${project.projectId},
      ${project.moduleId},
      ${`${project.code}-F-1`},
      '成员管理测试功能',
      ${owner.userId}
    )
    RETURNING id
  `;
  return {
    admin,
    owner,
    project,
    featureId: feature!.id,
  };
}

async function addMember(projectId: number, userId: number): Promise<void> {
  await client.sql`
    INSERT INTO app.project_members (project_id, user_id)
    VALUES (${projectId}, ${userId})
  `;
}

/**
 * ADR-033 §6：组长不能被移除；需要移除创建者时，先由系统管理员
 * 通过 setProjectMemberRole 撤销组长角色。
 */
async function revokeLeaderRole(
  projectId: number,
  actorValue: Actor,
  userId: number,
): Promise<void> {
  const response = await request(
    "POST",
    `/projects/${projectId}/members/${userId}/role`,
    actorValue,
    { role: "MEMBER" },
    { key: randomUUID() },
  );
  if (response.status !== 200) {
    throw new Error(`revokeLeaderRole failed with ${String(response.status)}`);
  }
}

/** ADR-033：测试夹具直接写入项目内角色（迁移 0015 的 role 列）。 */
async function addMemberWithRole(
  projectId: number,
  userId: number,
  role: "MEMBER" | "PROJECT_ADMIN" | "LEADER",
): Promise<void> {
  await client.sql`
    INSERT INTO app.project_members (project_id, user_id, role)
    VALUES (${projectId}, ${userId}, ${role})
  `;
}

async function createFeatureTask(
  fixtureValue: Fixture,
  assigneeId: number,
): Promise<{ readonly id: number; readonly rowVersion: number }> {
  const task = await uow.run((tx) =>
    management.execute(tx, {
      operation: "createTask",
      actorId: fixtureValue.admin.userId,
      projectId: fixtureValue.project.projectId,
      moduleId: fixtureValue.project.moduleId,
      featureId: fixtureValue.featureId,
      edit: {
        title: "成员管理任务",
        description: "用于验证成员移除与改派",
        priority: "NORMAL",
        assigneeId,
        dueAt: null,
      },
      requestId: randomUUID(),
    }),
  );
  return { id: task.id, rowVersion: task.rowVersion };
}

async function request(
  method: string,
  path: string,
  who?: Actor,
  body?: unknown,
  options: {
    readonly key?: string;
    readonly omitCsrf?: boolean;
    readonly omitIdempotency?: boolean;
    readonly contentType?: string;
  } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    ...(method === "GET"
      ? {}
      : { origin: base, "sec-fetch-site": "same-origin" }),
    ...(who === undefined ? {} : { cookie: who.cookie }),
    ...(options.omitCsrf === true ? {} : { "x-csrf-token": who?.csrf ?? "" }),
    "content-type": options.contentType ?? "application/json",
    ...(options.omitIdempotency === true
      ? {}
      : { "Idempotency-Key": options.key ?? randomUUID() }),
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

beforeAll(async () => {
  client = createDatabaseClient(testUrls().runtime, {
    applicationName: "inpulse-f05-member-management",
  });
  auditReader = createDatabaseClient(testUrls().auditReader, {
    applicationName: "inpulse-f05-member-management-audit",
  });
  uow = new PostgresUnitOfWork(client);

  const sessions = new PostgresUserSessionRepository();
  const csrf = new PostgresSessionCsrfTokenRepository();
  const auth = new SessionAuthService(uow, sessions, tokens);
  audit = new PostgresAuditWritePort({
    currentVersion: 1,
    keyFor: () => key,
  });
  const activity = new PostgresActivityWritePort();
  const notifications = new PostgresNotificationWritePort();
  const search = new PostgresSearchProjectionWritePort();
  const access = new PostgresProjectAccessQueryPort(client);

  management = new TasksManagementService(
    access,
    new PostgresModuleQueryPort(),
    new PostgresFeatureQueryPort(),
    new PostgresFeatureReadPort(),
    new PostgresProjectCodePort(),
    new PostgresProjectMembersQueryPort(),
    new ProjectRoleGateService(access, new PostgresProjectMembersQueryPort()),
    uow,
    new TaskManagementRepository(),
    audit,
    activity,
    search,
    notifications,
    new PostgresModuleReadPort(),
  );
  memberService = new ProjectMemberManagementService(
    new PostgresProjectsWritePort(),
    new PostgresActiveUsersQueryPort(),
    access,
    new ProjectMemberTaskCommandPort(
      new TaskManagementRepository(),
      management,
    ),
    new ProjectRoleGateService(access, new PostgresProjectMembersQueryPort()),
    audit,
    activity,
    notifications,
  );
  const http = new ProjectMemberManagementHttpService(
    auth,
    new AuthenticatedMutationService(auth, csrf, tokens),
    uow,
    memberService,
    new IdempotencyHttpService(
      new IdempotencyRunner(uow, new PostgresIdempotencyStore()),
      { currentVersion: 1, currentKey: () => key, keyFor: () => key },
      resolveRegisteredRoute,
    ),
  );

  class TestModule {}
  Module({
    controllers: [ProjectMemberManagementController],
    providers: [
      { provide: ProjectMemberManagementHttpService, useValue: http },
    ],
  })(TestModule);
  app = await NestFactory.create(TestModule, { logger: false });
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalInterceptors(new ContractResponseInterceptor());
  app.setGlobalPrefix("api/v1");
  await app.listen(0, "127.0.0.1");
  base = await app.getUrl();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await app?.close();
  await client?.close();
  await auditReader?.close();
});

describe("F-05 project member management API", () => {
  it("lists member history and unfinished tasks for a fresh admin without requiring CSRF", async () => {
    const value = await fixture();
    const task = await createFeatureTask(value, value.owner.userId);

    const list = await request(
      "GET",
      `/projects/${value.project.projectId}/members`,
      value.admin,
      undefined,
      { omitCsrf: true },
    );
    expect(list.status).toBe(200);
    const history = schemaRegistry.ProjectMembersListResponse.schema.parse(
      await list.json(),
    );
    expect(
      history.items.some((item) => item.userId === value.owner.userId),
    ).toBe(true);

    const unfinished = await request(
      "GET",
      `/projects/${value.project.projectId}/members/${value.owner.userId}/unfinished-tasks`,
      value.admin,
      undefined,
      { omitCsrf: true },
    );
    expect(unfinished.status).toBe(200);
    const body =
      schemaRegistry.ProjectMemberUnfinishedTasksResponse.schema.parse(
        await unfinished.json(),
      );
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      taskId: task.id,
      assigneeId: value.owner.userId,
      rowVersion: task.rowVersion,
    });
  });

  it("rejects anonymous reads, hides projects from non-members and forbids plain members (ADR-033)", async () => {
    const value = await fixture();
    const normal = await actor(false);
    const secondAdmin = await actor(true);
    const path = `/projects/${value.project.projectId}/members`;

    await expectError(
      await request("GET", path),
      401,
      "PROJECT_MEMBER_SESSION_REQUIRED",
    );
    // 非成员统一 404，不泄露项目存在性。
    await expectError(
      await request("GET", path, normal),
      404,
      "PROJECT_MEMBER_NOT_FOUND",
    );
    expect((await request("GET", path, secondAdmin)).status).toBe(200);

    // 本项目普通成员 403。
    const plain = await actor(false);
    await addMember(value.project.projectId, plain.userId);
    await expectError(
      await request("GET", path, plain),
      403,
      "PROJECT_MEMBER_MANAGE_FORBIDDEN",
    );

    await expectError(
      await request("GET", "/projects/999999/members", value.admin),
      404,
      "PROJECT_MEMBER_NOT_FOUND",
    );
  });

  it("adds a member with audit, activity, notification, idempotent replay and safe rejections", async () => {
    const value = await fixture();
    const candidate = await actor(false);
    const path = `/projects/${value.project.projectId}/members`;
    const key = randomUUID();

    const created = await request(
      "POST",
      path,
      value.admin,
      { userId: candidate.userId },
      { key },
    );
    expect(created.status).toBe(200);
    const createdBody = schemaRegistry.AddProjectMemberResponse.schema.parse(
      await created.json(),
    );
    expect(createdBody.member).toMatchObject({
      projectId: value.project.projectId,
      userId: candidate.userId,
      status: "ACTIVE",
    });

    const replay = await request(
      "POST",
      path,
      value.admin,
      { userId: candidate.userId },
      { key },
    );
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(createdBody);

    const duplicate = await request(
      "POST",
      path,
      value.admin,
      { userId: candidate.userId },
      { key: randomUUID() },
    );
    await expectError(duplicate, 409, "PROJECT_MEMBER_ALREADY_ACTIVE");

    await expectError(
      await request(
        "POST",
        path,
        value.admin,
        { userId: candidate.userId },
        { omitCsrf: true },
      ),
      422,
      "VALIDATION_FAILED",
    );
    await expectError(
      await request(
        "POST",
        path,
        value.admin,
        { userId: candidate.userId },
        { omitIdempotency: true },
      ),
      400,
      "IDEMPOTENCY_KEY_REQUIRED",
    );
    await expectError(
      await request(
        "POST",
        path,
        value.admin,
        { userId: candidate.userId },
        { contentType: "text/plain" },
      ),
      400,
      "PROJECT_MEMBER_CONTENT_TYPE_INVALID",
    );

    const disabled = await createUser(client.sql, { disabled: true });
    await expectError(
      await request("POST", path, value.admin, { userId: disabled }),
      422,
      "PROJECT_MEMBER_USER_INVALID",
    );
    await expectError(
      await request("POST", path, value.admin, { userId: 999999 }),
      422,
      "PROJECT_MEMBER_USER_INVALID",
    );

    const auditRows = (await auditReader.sql`
      SELECT action AS "action"
        FROM app.audit_logs
       WHERE project_id = ${value.project.projectId}
         AND action = 'project.member.add'
    `) as unknown as readonly { action: string }[];
    expect(auditRows).toHaveLength(1);

    const activityRows = (await client.sql`
      SELECT activity_type AS "activityType"
        FROM app.activity_projection
       WHERE project_id = ${value.project.projectId}
         AND activity_type = 'PROJECT_MEMBER_ADDED'
    `) as unknown as readonly { activityType: string }[];
    expect(activityRows).toHaveLength(1);

    const notificationRows = (await client.sql`
      SELECT notification_type AS "notificationType"
        FROM app.notifications
       WHERE project_id = ${value.project.projectId}
         AND recipient_id = ${candidate.userId}
         AND notification_type = 'PROJECT_JOINED'
    `) as unknown as readonly { notificationType: string }[];
    expect(notificationRows).toHaveLength(1);
  });

  it("removes a member, reassigns requested tasks and preserves project creator provenance", async () => {
    const value = await fixture();
    const assignee = await actor(false);
    await addMember(value.project.projectId, assignee.userId);
    const task = await createFeatureTask(value, value.owner.userId);
    // ADR-033：创建者默认是组长，移除前需先撤销组长角色。
    await revokeLeaderRole(
      value.project.projectId,
      value.admin,
      value.owner.userId,
    );
    const removePath = `/projects/${value.project.projectId}/members/${value.owner.userId}/remove`;
    const key = randomUUID();

    const response = await request(
      "POST",
      removePath,
      value.admin,
      {
        reassignments: [
          {
            taskId: task.id,
            moduleId: value.project.moduleId,
            featureId: value.featureId,
            rowVersion: task.rowVersion,
            assigneeId: assignee.userId,
          },
        ],
      },
      { key },
    );
    expect(response.status).toBe(200);
    const body = schemaRegistry.RemoveProjectMemberResponse.schema.parse(
      await response.json(),
    );
    expect(body.reassignedTaskIds).toEqual([task.id]);
    expect(body.unfinishedTaskCount).toBe(0);
    expect(body.member).toMatchObject({
      userId: value.owner.userId,
      status: "REMOVED",
    });

    const taskRows = (await client.sql`
      SELECT assignee_id AS "assigneeId"
        FROM app.tasks
       WHERE id = ${task.id}
    `) as unknown as readonly { assigneeId: number }[];
    expect(taskRows[0]!.assigneeId).toBe(assignee.userId);

    const projectRows = (await client.sql`
      SELECT created_by AS "createdBy"
        FROM app.projects
       WHERE id = ${value.project.projectId}
    `) as unknown as readonly { createdBy: number }[];
    expect(projectRows[0]!.createdBy).toBe(value.owner.userId);

    await expectError(
      await request(
        "GET",
        `/projects/${value.project.projectId}/members/${value.owner.userId}/unfinished-tasks`,
        value.admin,
      ),
      404,
      "PROJECT_MEMBER_NOT_FOUND",
    );
  });

  it("keeps un-reassigned tasks on the removed owner and reports unfinished count", async () => {
    const value = await fixture();
    const task = await createFeatureTask(value, value.owner.userId);
    // ADR-033：创建者默认是组长，移除前需先撤销组长角色。
    await revokeLeaderRole(
      value.project.projectId,
      value.admin,
      value.owner.userId,
    );
    const removePath = `/projects/${value.project.projectId}/members/${value.owner.userId}/remove`;

    const response = await request(
      "POST",
      removePath,
      value.admin,
      { reassignments: [] },
      { key: randomUUID() },
    );
    expect(response.status).toBe(200);
    const body = schemaRegistry.RemoveProjectMemberResponse.schema.parse(
      await response.json(),
    );
    expect(body.reassignedTaskIds).toEqual([]);
    expect(body.unfinishedTaskCount).toBe(1);

    const taskRows = (await client.sql`
      SELECT assignee_id AS "assigneeId"
        FROM app.tasks
       WHERE id = ${task.id}
    `) as unknown as readonly { assigneeId: number }[];
    expect(taskRows[0]!.assigneeId).toBe(value.owner.userId);

    const auditRows = (await auditReader.sql`
      SELECT action AS "action"
        FROM app.audit_logs
       WHERE project_id = ${value.project.projectId}
         AND action = 'project.member.remove'
    `) as unknown as readonly { action: string }[];
    expect(auditRows).toHaveLength(1);
  });

  it("rolls back member insert, notification and activity when audit fails", async () => {
    const value = await fixture();
    const candidate = await actor(false);
    const spy = vi
      .spyOn(audit, "append")
      .mockRejectedValueOnce(new Error("audit unavailable"));

    const response = await request(
      "POST",
      `/projects/${value.project.projectId}/members`,
      value.admin,
      { userId: candidate.userId },
      { key: randomUUID() },
    );
    await expectError(response, 500, "INTERNAL_ERROR");

    const memberRows = (await client.sql`
      SELECT id
        FROM app.project_members
       WHERE project_id = ${value.project.projectId}
         AND user_id = ${candidate.userId}
    `) as unknown as readonly { id: number }[];
    expect(memberRows).toHaveLength(0);
    expect(spy).toHaveBeenCalledOnce();
  });

  it("rejects removing a missing or already removed member", async () => {
    const value = await fixture();
    const candidate = await actor(false);
    await addMember(value.project.projectId, candidate.userId);
    const removePath = `/projects/${value.project.projectId}/members/${candidate.userId}/remove`;

    const removed = await request(
      "POST",
      removePath,
      value.admin,
      { reassignments: [] },
      { key: randomUUID() },
    );
    expect(removed.status).toBe(200);

    await expectError(
      await request(
        "POST",
        removePath,
        value.admin,
        { reassignments: [] },
        { key: randomUUID() },
      ),
      404,
      "PROJECT_MEMBER_NOT_FOUND",
    );
    await expectError(
      await request(
        "POST",
        `/projects/${value.project.projectId}/members/999999/remove`,
        value.admin,
        { reassignments: [] },
        { key: randomUUID() },
      ),
      404,
      "PROJECT_MEMBER_NOT_FOUND",
    );
  });

  it("rolls back task reassignment and member removal when audit fails", async () => {
    const value = await fixture();
    const assignee = await actor(false);
    await addMember(value.project.projectId, assignee.userId);
    const task = await createFeatureTask(value, value.owner.userId);
    // ADR-033：创建者默认是组长，移除前需先撤销组长角色。
    await revokeLeaderRole(
      value.project.projectId,
      value.admin,
      value.owner.userId,
    );
    const spy = vi
      .spyOn(audit, "append")
      .mockRejectedValueOnce(new Error("audit unavailable"));

    const response = await request(
      "POST",
      `/projects/${value.project.projectId}/members/${value.owner.userId}/remove`,
      value.admin,
      {
        reassignments: [
          {
            taskId: task.id,
            moduleId: value.project.moduleId,
            featureId: value.featureId,
            rowVersion: task.rowVersion,
            assigneeId: assignee.userId,
          },
        ],
      },
      { key: randomUUID() },
    );
    await expectError(response, 500, "INTERNAL_ERROR");

    const taskRows = (await client.sql`
      SELECT assignee_id AS "assigneeId"
        FROM app.tasks
       WHERE id = ${task.id}
    `) as unknown as readonly { assigneeId: number }[];
    expect(taskRows[0]!.assigneeId).toBe(value.owner.userId);

    const memberRows = (await client.sql`
      SELECT status
        FROM app.project_members
       WHERE project_id = ${value.project.projectId}
         AND user_id = ${value.owner.userId}
         AND removed_at IS NULL
    `) as unknown as readonly { status: string }[];
    expect(memberRows).toHaveLength(1);
    expect(memberRows[0]!.status).toBe("ACTIVE");
    expect(spy).toHaveBeenCalled();
  });

  it("backfills the creator membership as LEADER and keeps other members on MEMBER", async () => {
    const value = await fixture();
    const plain = await actor(false);
    await addMember(value.project.projectId, plain.userId);
    const roleRows = (await client.sql`
      SELECT user_id AS "userId", role
        FROM app.project_members
       WHERE project_id = ${value.project.projectId}
         AND status = 'ACTIVE'
       ORDER BY user_id
    `) as unknown as readonly { userId: number; role: string }[];
    const creator = roleRows.find((row) => row.userId === value.owner.userId);
    const normal = roleRows.find((row) => row.userId === plain.userId);
    expect(creator?.role).toBe("LEADER");
    expect(normal?.role).toBe("MEMBER");
  });

  it("lets the project leader manage members without any system admin flag (ADR-033)", async () => {
    const value = await fixture();
    const candidate = await actor(false);

    // 组长（创建者本人，非系统管理员）可以查看成员。
    const list = await request(
      "GET",
      `/projects/${value.project.projectId}/members`,
      value.owner,
      undefined,
      { omitCsrf: true },
    );
    expect(list.status).toBe(200);

    // 组长可以添加成员。
    const added = await request(
      "POST",
      `/projects/${value.project.projectId}/members`,
      value.owner,
      { userId: candidate.userId },
      { key: randomUUID() },
    );
    expect(added.status).toBe(200);

    // 本项目普通成员不能管理成员（403）。
    await expectError(
      await request(
        "GET",
        `/projects/${value.project.projectId}/members`,
        candidate,
        undefined,
        {
          omitCsrf: true,
        },
      ),
      403,
      "PROJECT_MEMBER_MANAGE_FORBIDDEN",
    );
    await expectError(
      await request(
        "POST",
        `/projects/${value.project.projectId}/members/${candidate.userId}/remove`,
        candidate,
        { reassignments: [] },
        { key: randomUUID() },
      ),
      403,
      "PROJECT_MEMBER_MANAGE_FORBIDDEN",
    );
  });

  it("lets a project admin manage members but never appoint roles (ADR-033)", async () => {
    const value = await fixture();
    const projectAdmin = await actor(false);
    await addMemberWithRole(
      value.project.projectId,
      projectAdmin.userId,
      "PROJECT_ADMIN",
    );
    const candidate = await actor(false);

    const added = await request(
      "POST",
      `/projects/${value.project.projectId}/members`,
      projectAdmin,
      { userId: candidate.userId },
      { key: randomUUID() },
    );
    expect(added.status).toBe(200);

    await expectError(
      await request(
        "POST",
        `/projects/${value.project.projectId}/members/${candidate.userId}/role`,
        projectAdmin,
        { role: "PROJECT_ADMIN" },
        { key: randomUUID() },
      ),
      403,
      "PROJECT_MEMBER_ROLE_FORBIDDEN",
    );
  });

  it("appoints project admins as the leader, protects the leader row and forbids leader self-appointment", async () => {
    const value = await fixture();
    const target = await actor(false);
    await addMember(value.project.projectId, target.userId);
    const rolePath = `/projects/${value.project.projectId}/members/${target.userId}/role`;

    // 组长任命项目管理员。
    const promoted = await request(
      "POST",
      rolePath,
      value.owner,
      { role: "PROJECT_ADMIN" },
      { key: randomUUID() },
    );
    expect(promoted.status).toBe(200);
    const promotedBody =
      schemaRegistry.SetProjectMemberRoleResponse.schema.parse(
        await promoted.json(),
      );
    expect(promotedBody.member.role).toBe("PROJECT_ADMIN");

    const auditRows = (await auditReader.sql`
      SELECT action AS "action"
        FROM app.audit_logs
       WHERE project_id = ${value.project.projectId}
         AND action = 'project.member.role.set'
    `) as unknown as readonly { action: string }[];
    expect(auditRows).toHaveLength(1);

    const activityRows = (await client.sql`
      SELECT activity_type AS "activityType"
        FROM app.activity_projection
       WHERE project_id = ${value.project.projectId}
         AND activity_type = 'PROJECT_MEMBER_ROLE_CHANGED'
    `) as unknown as readonly { activityType: string }[];
    expect(activityRows).toHaveLength(1);

    // 组长不能任命或转移组长角色。
    await expectError(
      await request(
        "POST",
        rolePath,
        value.owner,
        { role: "LEADER" },
        { key: randomUUID() },
      ),
      403,
      "PROJECT_MEMBER_LEADER_ASSIGN_FORBIDDEN",
    );

    // 组长不能被移除。
    await expectError(
      await request(
        "POST",
        `/projects/${value.project.projectId}/members/${value.owner.userId}/remove`,
        value.admin,
        { reassignments: [] },
        { key: randomUUID() },
      ),
      409,
      "PROJECT_MEMBER_LEADER_PROTECTED",
    );

    // 系统管理员转移组长：目标成为 LEADER，原组长自动降级为 MEMBER。
    const transferred = await request(
      "POST",
      rolePath,
      value.admin,
      { role: "LEADER" },
      { key: randomUUID() },
    );
    expect(transferred.status).toBe(200);
    const transferredBody =
      schemaRegistry.SetProjectMemberRoleResponse.schema.parse(
        await transferred.json(),
      );
    expect(transferredBody.member.role).toBe("LEADER");

    const roleRows = (await client.sql`
      SELECT user_id AS "userId", role
        FROM app.project_members
       WHERE project_id = ${value.project.projectId}
         AND status = 'ACTIVE'
       ORDER BY user_id
    `) as unknown as readonly { userId: number; role: string }[];
    expect(roleRows.find((row) => row.userId === target.userId)?.role).toBe(
      "LEADER",
    );
    expect(
      roleRows.find((row) => row.userId === value.owner.userId)?.role,
    ).toBe("MEMBER");
  });

  it("refuses role writes for non-members and removed members without leaking existence", async () => {
    const value = await fixture();
    const outsider = await actor(false);
    const removed = await actor(false);
    await addMember(value.project.projectId, removed.userId);
    await client.sql`
      UPDATE app.project_members
         SET status = 'REMOVED', removed_at = now(), role = 'MEMBER'
       WHERE project_id = ${value.project.projectId}
         AND user_id = ${removed.userId}
    `;

    await expectError(
      await request(
        "POST",
        `/projects/${value.project.projectId}/members/${outsider.userId}/role`,
        value.admin,
        { role: "PROJECT_ADMIN" },
        { key: randomUUID() },
      ),
      404,
      "PROJECT_MEMBER_NOT_FOUND",
    );
    await expectError(
      await request(
        "POST",
        `/projects/${value.project.projectId}/members/${removed.userId}/role`,
        value.admin,
        { role: "PROJECT_ADMIN" },
        { key: randomUUID() },
      ),
      404,
      "PROJECT_MEMBER_NOT_FOUND",
    );
    // 非成员访问其它项目的角色接口统一 404。
    await expectError(
      await request(
        "POST",
        `/projects/${value.project.projectId}/members/${value.owner.userId}/role`,
        outsider,
        { role: "PROJECT_ADMIN" },
        { key: randomUUID() },
      ),
      404,
      "PROJECT_MEMBER_NOT_FOUND",
    );
  });

  it("replays role writes only after re-verifying the manage role (ADR-033)", async () => {
    const value = await fixture();
    const target = await actor(false);
    await addMember(value.project.projectId, target.userId);
    const rolePath = `/projects/${value.project.projectId}/members/${target.userId}/role`;
    const key = randomUUID();

    // 组长（非系统管理员）任命项目管理员。
    const first = await request(
      "POST",
      rolePath,
      value.owner,
      { role: "PROJECT_ADMIN" },
      { key },
    );
    expect(first.status).toBe(200);
    const firstBody = schemaRegistry.SetProjectMemberRoleResponse.schema.parse(
      await first.json(),
    );

    // 同 Key、同 body 重放返回缓存响应。
    const replay = await request(
      "POST",
      rolePath,
      value.owner,
      { role: "PROJECT_ADMIN" },
      { key },
    );
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(firstBody);

    // 组长被降级为普通成员后：新的角色任命被门禁拒绝（403）。
    await client.sql`
      UPDATE app.project_members
         SET role = 'MEMBER'
       WHERE project_id = ${value.project.projectId}
         AND user_id = ${value.owner.userId}
    `;
    await expectError(
      await request(
        "POST",
        rolePath,
        value.owner,
        { role: "MEMBER" },
        { key: randomUUID() },
      ),
      403,
      "PROJECT_MEMBER_ROLE_FORBIDDEN",
    );

    // 同一操作者降级后用原 Key 重放：重放授权器必须重新校验项目内
    // 管理角色并拒绝，不泄露已存响应。
    await expectError(
      await request(
        "POST",
        rolePath,
        value.owner,
        { role: "PROJECT_ADMIN" },
        { key },
      ),
      403,
      "PROJECT_MEMBER_MANAGE_FORBIDDEN",
    );
  });
});
