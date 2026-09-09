import { PostgresModuleReadPort } from "../src/modules/modules/postgres-module-read-port.js";
import { PostgresFeatureReadPort } from "../src/modules/features/postgres-feature-read-port.js";
import { PostgresProjectMembersQueryPort } from "../src/modules/projects/postgres-project-members-query-port.js";
import { PostgresNotificationWritePort } from "../src/modules/notifications/postgres-notification-write-port.js";
import { PostgresModuleQueryPort } from "../src/modules/modules/postgres-module-query-port.js";
import { PostgresProjectCodePort } from "../src/modules/projects/postgres-project-code-port.js";
import { PostgresFeatureQueryPort } from "../src/modules/features/postgres-feature-query-port.js";
import "reflect-metadata";
import { randomBytes, randomUUID } from "node:crypto";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  createDatabaseClient,
  type DatabaseClient,
} from "@inpulse/database/client";
import {
  taskItemSchema,
  moduleTaskItemSchema,
  taskListResponseSchema,
  taskAssigneesResponseSchema,
  schemaRegistry,
} from "@inpulse/api-contract";
import {
  beforeAll,
  afterAll,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { SessionAuthService } from "../src/auth/session-auth.service.js";
import { SessionTokenService } from "../src/auth/session-token.service.js";
import { VersionedHmacKeyring } from "../src/auth/keyring.js";
import { PostgresUserSessionRepository } from "../src/auth/user-session.repository.js";
import { PostgresSessionCsrfTokenRepository } from "../src/auth/session-csrf-token.repository.js";
import { AuthenticatedMutationService } from "../src/auth/authenticated-mutation.service.js";
import { PostgresUnitOfWork } from "../src/database/unit-of-work.js";
import { PostgresAuditWritePort } from "../src/audit/postgres-audit-write-port.js";
import { IdempotencyHttpService } from "../src/idempotency/http-service.js";
import { IdempotencyRunner } from "../src/idempotency/runner.js";
import { PostgresIdempotencyStore } from "../src/idempotency/store.js";
import { resolveRegisteredRoute } from "../src/idempotency/route.js";
import { PostgresProjectAccessQueryPort } from "../src/modules/projects/postgres-project-access-query-port.js";
import { PostgresActivityWritePort } from "../src/modules/activity/postgres-activity-write-port.js";
import { PostgresSearchProjectionWritePort } from "../src/modules/search/postgres-search-projection-write-port.js";
import { TaskManagementRepository } from "../src/modules/tasks/task-management.repository.js";
import { TasksManagementService } from "../src/modules/tasks/tasks-management.service.js";
import { TasksHttpService } from "../src/modules/tasks/tasks-http.service.js";
import { TasksController } from "../src/modules/tasks/tasks.controller.js";
import { ApiExceptionFilter } from "../src/http/api-exception.filter.js";
import { ContractResponseInterceptor } from "../src/http/contract-response.interceptor.js";
import {
  createProject,
  createUser,
  removeMember,
  testUrls,
  type ProjectFixture,
} from "./database.helpers.js";

let client: DatabaseClient;
let auditReader: DatabaseClient;
let app: INestApplication | undefined;
let base: string;
let uow: PostgresUnitOfWork;
let management: TasksManagementService;
let audit: PostgresAuditWritePort;
let search: PostgresSearchProjectionWritePort;
let activity: PostgresActivityWritePort;
let notifications: PostgresNotificationWritePort;
const key = randomBytes(32);
const tokens = new SessionTokenService(
  VersionedHmacKeyring.fromEntries([{ version: 1, key }], 1),
);
interface Actor {
  userId: number;
  sessionId: number;
  cookie: string;
  csrf: string;
}

beforeAll(async () => {
  client = createDatabaseClient(testUrls().runtime, {
    applicationName: "inpulse-f14-http",
  });
  auditReader = createDatabaseClient(testUrls().auditReader, {
    applicationName: "inpulse-f14-audit-evidence",
  });
  uow = new PostgresUnitOfWork(client);
  const sessions = new PostgresUserSessionRepository();
  const csrf = new PostgresSessionCsrfTokenRepository();
  const auth = new SessionAuthService(uow, sessions, tokens);
  audit = new PostgresAuditWritePort({ currentVersion: 1, keyFor: () => key });
  search = new PostgresSearchProjectionWritePort();
  activity = new PostgresActivityWritePort();
  notifications = new PostgresNotificationWritePort();
  management = new TasksManagementService(
    new PostgresProjectAccessQueryPort(client),
    new PostgresModuleQueryPort(),
    new PostgresFeatureQueryPort(),
    new PostgresFeatureReadPort(),
    new PostgresProjectCodePort(),
    new PostgresProjectMembersQueryPort(),
    uow,
    new TaskManagementRepository(),
    audit,
    activity,
    search,
    notifications,
    new PostgresModuleReadPort(),
  );
  const http = new TasksHttpService(
    auth,
    new AuthenticatedMutationService(auth, csrf, tokens),
    new IdempotencyHttpService(
      new IdempotencyRunner(uow, new PostgresIdempotencyStore()),
      { currentVersion: 1, currentKey: () => key, keyFor: () => key },
      resolveRegisteredRoute,
    ),
    management,
  );
  class TestModule {}
  Module({
    controllers: [TasksController],
    providers: [{ provide: TasksHttpService, useValue: http }],
  })(TestModule);
  app = await NestFactory.create(TestModule, { logger: false });
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalInterceptors(new ContractResponseInterceptor());
  app.setGlobalPrefix("api/v1");
  await app.listen(0, "127.0.0.1");
  base = await app.getUrl();
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await app?.close();
  await client?.close();
  await auditReader?.close();
});

async function actor(admin = false): Promise<Actor> {
  const userId = await createUser(client.sql, { admin });
  const cookie = randomBytes(32).toString("base64url");
  const csrf = randomBytes(32).toString("base64url");
  const [session] = await client.sql<
    { id: number }[]
  >`INSERT INTO app.user_sessions (user_id, token_hash, token_hash_key_version, auth_version_at_issue, auth_state, recovery_rotation_generation, recovery_rotation_consumed_generation, idle_expires_at, absolute_expires_at, reauthenticated_at, mfa_verified_at) VALUES (${userId}, ${tokens.hash(cookie).hash}, 1, 1, 'AUTHENTICATED', 0, 0, now() + interval '1 hour', now() + interval '1 day', ${admin ? client.sql`now()` : client.sql`NULL`}, ${admin ? client.sql`now()` : client.sql`NULL`}) RETURNING id`;
  await client.sql`INSERT INTO app.session_csrf_tokens (session_id, token_hash, expires_at) VALUES (${session!.id}, ${tokens.hash(csrf).hash}, now() + interval '1 hour')`;
  return {
    userId,
    sessionId: session!.id,
    cookie: `__Host-session=${cookie}`,
    csrf,
  };
}
type ScopeFixture = ProjectFixture & { featureId: number };
async function fixture(): Promise<{ member: Actor; project: ScopeFixture }> {
  const member = await actor();
  const project = await createProject(client.sql, member.userId);
  const [f] = await client.sql<
    { id: number }[]
  >`INSERT INTO app.features (project_id,module_id,code,name,created_by) VALUES (${project.projectId},${project.moduleId},${project.code + "-F-1"},'支付',${member.userId}) RETURNING id`;
  return { member, project: { ...project, featureId: f!.id } };
}
async function request(
  project: { projectId: number; moduleId: number; featureId: number | null },
  method: string,
  who?: Actor,
  body?: unknown,
  suffix = "",
  version?: number,
  idempotencyKey: string = randomUUID(),
) {
  return fetch(
    `${base}/api/v1/projects/${project.projectId}/modules/${project.moduleId}${project.featureId === null ? "" : `/features/${project.featureId}`}/tasks${suffix}`,
    {
      method,
      headers: {
        origin: base,
        "sec-fetch-site": "same-origin",
        ...(who
          ? { cookie: who.cookie, "x-csrf-token": who.csrf }
          : { "x-csrf-token": "a".repeat(43) }),
        "content-type": "application/json",
        "Idempotency-Key": idempotencyKey,
        ...(version ? { "If-Match": `"${version}"` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
}
async function error(response: Response, status: number, code?: string) {
  expect(response.status).toBe(status);
  const body = schemaRegistry.ErrorResponse.schema.parse(await response.json());
  expect(response.headers.get("x-request-id")).toBe(body.requestId);
  if (code) expect(body.code).toBe(code);
  expect(JSON.stringify(body)).not.toMatch(
    /INSERT INTO|SELECT |stack|constraint_name/,
  );
}

const edit = (assigneeId: number, title = "修复退款") => ({
  title,
  description: "支付退款说明",
  priority: "NORMAL",
  assigneeId,
  dueAt: null,
});
async function create(project: ScopeFixture, member: Actor) {
  const response = await request(project, "POST", member, edit(member.userId));
  expect(response.status, await response.clone().text()).toBe(200);
  return taskItemSchema.parse(await response.json());
}
async function addMember(projectId: number, userId: number) {
  await client.sql`INSERT INTO app.project_members (project_id,user_id) VALUES (${projectId},${userId})`;
}
describe("F-15 module tasks", () => {
  it("rechecks module task permissions and all saved impact resources before replay", async () => {
    const { project, member } = await fixture();
    const other = await fixture();
    const scope = { ...project, featureId: null };
    const key = randomUUID();
    const input = {
      ...edit(member.userId),
      impactFeatureIds: [project.featureId],
    };
    const first = await request(
      scope,
      "POST",
      member,
      input,
      "",
      undefined,
      key,
    );
    expect(first.status).toBe(200);
    const item = moduleTaskItemSchema.parse(await first.json());
    await error(await request(scope, "GET"), 401);
    await error(await request(scope, "GET", other.member), 404);
    await error(
      await request(scope, "PATCH", other.member, input, `/${item.id}`, 1),
      404,
    );
    await removeMember(client.sql, project.projectId, member.userId);
    await error(
      await request(scope, "POST", member, input, "", undefined, key),
      404,
    );
  });
  const moduleScope = (project: ScopeFixture) => ({
    ...project,
    featureId: null,
  });
  async function anotherFeature(project: ScopeFixture, member: Actor) {
    const [row] = await client.sql<
      { id: number }[]
    >`INSERT INTO app.features (project_id,module_id,code,name,created_by) VALUES (${project.projectId},${project.moduleId},${project.code + "-F-" + Math.floor(Math.random() * 100000 + 2)},'影响功能',${member.userId}) RETURNING id`;
    return row!.id;
  }
  async function createModule(
    project: ScopeFixture,
    member: Actor,
    ids: number[] = [],
  ) {
    const response = await request(moduleScope(project), "POST", member, {
      ...edit(member.userId),
      impactFeatureIds: ids,
    });
    expect(response.status, await response.clone().text()).toBe(200);
    return moduleTaskItemSchema.parse(await response.json());
  }
  it("stores one task with deduplicated same-module impacts and references once per feature", async () => {
    const { project, member } = await fixture();
    const second = await anotherFeature(project, member);
    const item = await createModule(project, member, [
      second,
      project.featureId,
      second,
    ]);
    expect(item).toMatchObject({
      scopeType: "MODULE",
      featureId: null,
      impactFeatureIds: [project.featureId, second],
    });
    expect(
      await client.sql`SELECT 1 FROM app.tasks WHERE project_id=${project.projectId}`,
    ).toHaveLength(1);
    for (const featureId of [project.featureId, second])
      expect(
        taskListResponseSchema.parse(
          await (
            await request({ ...project, featureId }, "GET", member)
          ).json(),
        ).items,
      ).toEqual([item]);
    expect(
      moduleTaskItemSchema.parse(
        await (
          await request(
            moduleScope(project),
            "GET",
            member,
            undefined,
            `/${item.id}`,
          )
        ).json(),
      ),
    ).toEqual(item);
    expect(
      await client.sql`SELECT 1 FROM app.task_feature_impacts WHERE task_id=${item.id}`,
    ).toHaveLength(2);
    await expect(
      client.sql`INSERT INTO app.task_feature_impacts(task_id,feature_id,module_id,project_id) VALUES (${item.id},${second},${project.moduleId},${project.projectId})`,
    ).rejects.toMatchObject({ code: "23505" });
    const foreign = await fixture();
    await expect(
      client.sql`INSERT INTO app.task_feature_impacts(task_id,feature_id,module_id,project_id) VALUES (${item.id},${foreign.project.featureId},${project.moduleId},${project.projectId})`,
    ).rejects.toMatchObject({ code: "23503" });
    const featureTask = await create(project, member);
    await expect(
      client.sql`INSERT INTO app.task_feature_impacts(task_id,feature_id,module_id,project_id) VALUES (${featureTask.id},${second},${project.moduleId},${project.projectId})`,
    ).rejects.toMatchObject({ code: "23514" });
  });
  it("accepts empty impacts, preserves one project number sequence and normalizes same-key reordered duplicates", async () => {
    const { project, member } = await fixture();
    const featureTask = await create(project, member);
    const module = await createModule(project, member);
    expect(featureTask.code).toBe(project.code + "-T-1");
    expect(module.code).toBe(project.code + "-T-2");
    const key = randomUUID();
    const input = {
      ...edit(member.userId),
      impactFeatureIds: [project.featureId, project.featureId],
    };
    const a = await request(
      moduleScope(project),
      "POST",
      member,
      input,
      "",
      undefined,
      key,
    );
    const body = await a.json();
    expect(
      await (
        await request(
          moduleScope(project),
          "POST",
          member,
          { ...input, impactFeatureIds: [project.featureId] },
          "",
          undefined,
          key,
        )
      ).json(),
    ).toEqual(body);
  });
  it("rejects foreign project/module impacts and scope injection, with no partial insert", async () => {
    const { project, member } = await fixture();
    const foreign = await fixture();
    await error(
      await request(moduleScope(project), "POST", member, {
        ...edit(member.userId),
        impactFeatureIds: [foreign.project.featureId],
      }),
      404,
    );
    const [module] = await client.sql<
      { id: number }[]
    >`INSERT INTO app.modules(project_id,name,created_by) VALUES (${project.projectId},'另一模块',${member.userId}) RETURNING id`;
    const wrong = await anotherFeature(
      { ...project, moduleId: module!.id },
      member,
    );
    await error(
      await request(moduleScope(project), "POST", member, {
        ...edit(member.userId),
        impactFeatureIds: [project.featureId, wrong],
      }),
      404,
    );
    await error(
      await request(moduleScope(project), "POST", member, {
        ...edit(member.userId),
        featureId: project.featureId,
        impactFeatureIds: [],
      }),
      422,
    );
    expect(
      await client.sql`SELECT 1 FROM app.tasks WHERE project_id=${project.projectId}`,
    ).toHaveLength(0);
  });
  it("removes and readds current relations with complete immutable audit snapshots", async () => {
    const { project, member } = await fixture();
    const item = await createModule(project, member, [project.featureId]);
    const [old] = await client.sql<
      { created_at: Date }[]
    >`SELECT created_at FROM app.task_feature_impacts WHERE task_id=${item.id}`;
    const patch = (ids: number[], version: number) =>
      request(
        moduleScope(project),
        "PATCH",
        member,
        { ...edit(member.userId), impactFeatureIds: ids },
        `/${item.id}`,
        version,
      );
    expect((await patch([], 1)).status).toBe(200);
    expect(
      taskListResponseSchema.parse(
        await (await request(project, "GET", member)).json(),
      ).items,
    ).toEqual([]);
    expect((await patch([project.featureId], 2)).status).toBe(200);
    const [fresh] = await client.sql<
      { created_at: Date }[]
    >`SELECT created_at FROM app.task_feature_impacts WHERE task_id=${item.id}`;
    expect(new Date(fresh!.created_at).getTime()).toBeGreaterThan(
      new Date(old!.created_at).getTime(),
    );
    const logs = await auditReader.sql<
      {
        event_payload: {
          impactsBefore: unknown[];
          impactsAfter: unknown[];
          removed: number[];
        };
      }[]
    >`SELECT event_payload FROM app.audit_logs WHERE project_id=${project.projectId} AND action='task.update' ORDER BY sequence_no`;
    expect(logs[0]!.event_payload.impactsBefore).toEqual([
      expect.objectContaining({
        taskId: item.id,
        projectId: project.projectId,
        moduleId: project.moduleId,
        featureId: project.featureId,
        relationType: "IMPACT",
        createdAt: new Date(old!.created_at).toISOString(),
      }),
    ]);
    expect(logs[0]!.event_payload.impactsAfter).toEqual([]);
    expect(logs[0]!.event_payload.removed).toEqual([project.featureId]);
  });
  it("preserves/removes archived existing impacts but rejects adding or readding them", async () => {
    const { project, member } = await fixture();
    const item = await createModule(project, member, [project.featureId]);
    await client.sql`UPDATE app.features SET status='ARCHIVED',archived_at=now(),row_version=row_version+1 WHERE id=${project.featureId}`;
    const patch = (ids: number[], version: number) =>
      request(
        moduleScope(project),
        "PATCH",
        member,
        { ...edit(member.userId, "编辑模块任务"), impactFeatureIds: ids },
        `/${item.id}`,
        version,
      );
    expect((await patch([project.featureId], 1)).status).toBe(200);
    expect((await patch([], 2)).status).toBe(200);
    await error(
      await patch([project.featureId], 3),
      409,
      "TASK_IMPACT_ARCHIVED",
    );
    await error(
      await request(moduleScope(project), "POST", member, {
        ...edit(member.userId),
        impactFeatureIds: [project.featureId],
      }),
      409,
    );
  });
  it("rolls back relation removal on audit failure and rejects stale concurrent updates", async () => {
    const { project, member } = await fixture();
    const second = await anotherFeature(project, member);
    const item = await createModule(project, member, [project.featureId]);
    const patch = (ids: number[]) =>
      request(
        moduleScope(project),
        "PATCH",
        member,
        { ...edit(member.userId), impactFeatureIds: ids },
        `/${item.id}`,
        1,
      );
    vi.spyOn(audit, "append").mockRejectedValueOnce(
      new Error("audit unavailable"),
    );
    await error(await patch([]), 500);
    expect(
      moduleTaskItemSchema.parse(
        await (
          await request(
            moduleScope(project),
            "GET",
            member,
            undefined,
            `/${item.id}`,
          )
        ).json(),
      ),
    ).toEqual(item);
    const results = await Promise.all([patch([second]), patch([])]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const success = moduleTaskItemSchema.parse(
      await results.find((r) => r.status === 200)!.json(),
    );
    expect(
      moduleTaskItemSchema.parse(
        await (
          await request(
            moduleScope(project),
            "GET",
            member,
            undefined,
            `/${item.id}`,
          )
        ).json(),
      ),
    ).toEqual(success);
  });
  it("waits for feature archival before adding an influence then rejects it", async () => {
    const { project, member } = await fixture();
    let release!: () => void;
    let acquired!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const ready = new Promise<void>((r) => {
      acquired = r;
    });
    const archive = uow.run(async (tx) => {
      await tx.sql`UPDATE app.features SET status='ARCHIVED',archived_at=now(),row_version=row_version+1 WHERE id=${project.featureId}`;
      acquired();
      await gate;
    });
    await ready;
    const pending = request(moduleScope(project), "POST", member, {
      ...edit(member.userId),
      impactFeatureIds: [project.featureId],
    });
    try {
      await vi.waitFor(
        async () =>
          expect(
            (
              await client.sql`SELECT pid FROM pg_stat_activity WHERE application_name='inpulse-f14-http' AND wait_event_type='Lock' AND cardinality(pg_blocking_pids(pid))>0`
            ).length,
          ).toBeGreaterThan(0),
        { timeout: 4000, interval: 30 },
      );
    } finally {
      release();
      await archive;
    }
    await error(await pending, 409, "TASK_IMPACT_ARCHIVED");
  });
});

describe("F-14 real HTTP / PostgreSQL", () => {
  it("preserves a valid 500-character title while fitting notification limits", async () => {
    const { project, member } = await fixture();
    const title = "任".repeat(500);
    const response = await request(
      project,
      "POST",
      member,
      edit(member.userId, title),
    );
    expect(response.status, await response.clone().text()).toBe(200);
    expect(taskItemSchema.parse(await response.json()).title).toBe(title);
    const [notification] = await client.sql<
      { title: string }[]
    >`SELECT title FROM app.notifications WHERE project_id=${project.projectId}`;
    expect(notification!.title.length).toBe(500);
  });
  it("maps an imported number collision to a safe 409 and rolls back the sequence", async () => {
    const { project, member } = await fixture();
    await uow.run(async (tx) => {
      const [task] = await tx.sql<
        { id: number }[]
      >`INSERT INTO app.tasks (project_id,module_id,feature_id,scope_type,code,title,assignee_id,creator_id) VALUES (${project.projectId},${project.moduleId},${project.featureId},'FEATURE',${project.code + "-T-1"},'导入任务',${member.userId},${member.userId}) RETURNING id`;
      await tx.sql`INSERT INTO app.task_status_history (task_id,project_id,to_work_status,changed_by) VALUES (${task!.id},${project.projectId},'TODO',${member.userId})`;
    });
    await error(
      await request(project, "POST", member, edit(member.userId)),
      409,
      "TASK_CODE_CONFLICT",
    );
    expect(
      await client.sql`SELECT 1 FROM app.code_sequences WHERE project_id=${project.projectId} AND entity_type='TASK'`,
    ).toHaveLength(0);
  });
  it("keeps archived history readable, rejects edits and stale successful replay after parent archival", async () => {
    const { project, member } = await fixture();
    const key = randomUUID();
    const body = edit(member.userId);
    const first = await request(
      project,
      "POST",
      member,
      body,
      "",
      undefined,
      key,
    );
    const item = taskItemSchema.parse(await first.json());
    await client.sql`UPDATE app.features SET status='ARCHIVED',archived_at=now(),row_version=row_version+1 WHERE id=${project.featureId}`;
    expect(
      (await request(project, "GET", member, undefined, `/${item.id}`)).status,
    ).toBe(200);
    await error(
      await request(project, "PATCH", member, body, `/${item.id}`, 1),
      409,
    );
    await error(
      await request(project, "POST", member, body, "", undefined, key),
      409,
    );
  });
  for (const target of [
    "project",
    "module",
    "feature",
    "member",
    "user",
  ] as const)
    it(`waits for concurrent ${target} archival/removal then rechecks`, async () => {
      const { project, member } = await fixture();
      const assignee = await actor();
      await addMember(project.projectId, assignee.userId);
      let release!: () => void;
      let acquired!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const ready = new Promise<void>((resolve) => {
        acquired = resolve;
      });
      const change = uow.run(async (tx) => {
        if (target === "project")
          await tx.sql`UPDATE app.projects SET status='ARCHIVED', archived_at=now(), row_version=row_version+1 WHERE id=${project.projectId}`;
        if (target === "module")
          await tx.sql`UPDATE app.modules SET status='ARCHIVED', archived_at=now(), row_version=row_version+1 WHERE id=${project.moduleId}`;
        if (target === "feature")
          await tx.sql`UPDATE app.features SET status='ARCHIVED', archived_at=now(), row_version=row_version+1 WHERE id=${project.featureId}`;
        if (target === "member")
          await tx.sql`UPDATE app.project_members SET status='REMOVED', removed_at=now() WHERE project_id=${project.projectId} AND user_id=${assignee.userId}`;
        if (target === "user")
          await tx.sql`UPDATE app.users SET status='DISABLED', disabled_at=now(), row_version=row_version+1 WHERE id=${assignee.userId}`;
        acquired();
        await gate;
      });
      await ready;
      const pending = request(project, "POST", member, edit(assignee.userId));
      try {
        await vi.waitFor(
          async () => {
            expect(
              (
                await client.sql`SELECT pid FROM pg_stat_activity WHERE application_name='inpulse-f14-http' AND wait_event_type='Lock' AND cardinality(pg_blocking_pids(pid))>0`
              ).length,
            ).toBeGreaterThan(0);
          },
          { timeout: 4000, interval: 30 },
        );
      } finally {
        release();
        await change;
      }
      await error(
        await pending,
        target === "member" || target === "user" ? 422 : 409,
      );
      expect(
        await client.sql`SELECT 1 FROM app.tasks WHERE project_id=${project.projectId}`,
      ).toHaveLength(0);
    });
  it("allows a global admin to create but requires their chosen assignee to be a project member", async () => {
    const { project, member } = await fixture();
    const admin = await actor(true);
    await error(await request(project, "POST", admin, edit(admin.userId)), 422);
    const result = await request(project, "POST", admin, edit(member.userId));
    expect(result.status).toBe(200);
  });
  it("rolls back a reassignment and version when notification fails", async () => {
    const { project, member } = await fixture();
    const next = await actor();
    await addMember(project.projectId, next.userId);
    const item = await create(project, member);
    vi.spyOn(notifications, "write").mockRejectedValueOnce(
      new Error("notification failure"),
    );
    await error(
      await request(
        project,
        "PATCH",
        member,
        edit(next.userId),
        `/${item.id}`,
        1,
      ),
      500,
    );
    expect(
      taskItemSchema.parse(
        await (
          await request(project, "GET", member, undefined, `/${item.id}`)
        ).json(),
      ),
    ).toEqual(item);
    expect(
      await client.sql`SELECT 1 FROM app.notifications WHERE project_id=${project.projectId}`,
    ).toHaveLength(1);
  });
  it("creates one TODO task/history and atomic projections/notification; reads list/detail/members", async () => {
    const { project, member } = await fixture();
    const item = await create(project, member);
    expect(item).toMatchObject({
      code: project.code + "-T-1",
      scopeType: "FEATURE",
      featureId: project.featureId,
      workStatus: "TODO",
      lifecycleStatus: "ACTIVE",
      rowVersion: 1,
    });
    const history =
      await client.sql`SELECT * FROM app.task_status_history WHERE task_id=${item.id}`;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      from_work_status: null,
      to_work_status: "TODO",
    });
    expect(
      taskListResponseSchema.parse(
        await (await request(project, "GET", member)).json(),
      ).items,
    ).toEqual([item]);
    expect(
      await (
        await request(project, "GET", member, undefined, `/${item.id}`)
      ).json(),
    ).toEqual(item);
    expect(
      taskAssigneesResponseSchema
        .parse(
          await (
            await request(project, "GET", member, undefined, "/assignees")
          ).json(),
        )
        .items.map((m: { id: number }) => m.id),
    ).toEqual([member.userId]);
    expect(
      await client.sql`SELECT 1 FROM app.notifications WHERE project_id=${project.projectId} AND recipient_id=${member.userId}`,
    ).toHaveLength(1);
    expect(
      await client.sql`SELECT 1 FROM app.search_projection WHERE project_id=${project.projectId} AND entity_type='TASK'`,
    ).toHaveLength(1);
  });
  it("rejects anonymous/foreign/removed/disabled actors and wrong project/module/feature identity", async () => {
    const { project, member } = await fixture();
    const other = await fixture();
    const item = await create(project, member);
    await error(await request(project, "GET"), 401);
    await error(await request(project, "GET", other.member), 404);
    await error(
      await request(
        { ...project, moduleId: other.project.moduleId },
        "GET",
        member,
      ),
      404,
    );
    await error(
      await request(
        { ...project, featureId: other.project.featureId },
        "GET",
        member,
        undefined,
        `/${item.id}`,
      ),
      404,
    );
    await error(
      await request(
        other.project,
        "GET",
        other.member,
        undefined,
        `/${item.id}`,
      ),
      404,
    );
    await removeMember(client.sql, project.projectId, member.userId);
    await error(await request(project, "GET", member), 404);
    await client.sql`UPDATE app.users SET status='DISABLED', disabled_at=now(), row_version=row_version+1 WHERE id=${other.member.userId}`;
    await error(await request(other.project, "GET", other.member), 401);
  });
  it("requires CSRF/key/version and rejects client identity injection", async () => {
    const { project, member } = await fixture();
    const item = await create(project, member);
    await error(
      await request(
        project,
        "POST",
        { ...member, csrf: "z".repeat(43) },
        edit(member.userId),
      ),
      401,
    );
    await error(
      await request(project, "POST", member, {
        ...edit(member.userId),
        code: "X-T-1",
      }),
      422,
    );
    await error(
      await request(project, "POST", member, {
        ...edit(member.userId),
        assigneeId: null,
      }),
      422,
    );
    await error(
      await request(
        project,
        "POST",
        member,
        edit(member.userId),
        "",
        undefined,
        "",
      ),
      400,
    );
    await error(
      await request(
        project,
        "PATCH",
        member,
        edit(member.userId),
        `/${item.id}`,
      ),
      422,
    );
  });
  it("only notifies newly assigned ACTIVE project members; retains removed historical assignee for unrelated edits", async () => {
    const { project, member } = await fixture();
    const next = await actor();
    const outsider = await actor();
    await addMember(project.projectId, next.userId);
    const item = await create(project, member);
    await error(
      await request(
        project,
        "PATCH",
        member,
        edit(outsider.userId),
        `/${item.id}`,
        1,
      ),
      422,
    );
    const changed = await request(
      project,
      "PATCH",
      member,
      edit(next.userId),
      `/${item.id}`,
      1,
    );
    expect(changed.status).toBe(200);
    await removeMember(client.sql, project.projectId, next.userId);
    expect(
      (
        await request(
          project,
          "PATCH",
          member,
          edit(next.userId, "历史负责人保留"),
          `/${item.id}`,
          2,
        )
      ).status,
    ).toBe(200);
    expect(
      await client.sql`SELECT 1 FROM app.notifications WHERE project_id=${project.projectId}`,
    ).toHaveLength(2);
    const members = taskAssigneesResponseSchema.parse(
      await (
        await request(project, "GET", member, undefined, "/assignees")
      ).json(),
    );
    expect(members.items.map((m: { id: number }) => m.id)).not.toContain(
      next.userId,
    );
    await error(await request(project, "POST", member, edit(next.userId)), 422);
  });
  it("replays exact success without extra side effects; checks changed semantics, If-Match, permissions", async () => {
    const { project, member } = await fixture();
    const key = randomUUID();
    const body = edit(member.userId);
    const first = await request(
      project,
      "POST",
      member,
      body,
      "",
      undefined,
      key,
    );
    expect(first.status).toBe(200);
    const item = taskItemSchema.parse(await first.json());
    expect(
      await (
        await request(project, "POST", member, body, "", undefined, key)
      ).json(),
    ).toEqual(item);
    await error(
      await request(
        project,
        "POST",
        member,
        { ...body, title: "different" },
        "",
        undefined,
        key,
      ),
      409,
    );
    const patchKey = randomUUID();
    expect(
      (
        await request(
          project,
          "PATCH",
          member,
          body,
          `/${item.id}`,
          1,
          patchKey,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          project,
          "PATCH",
          member,
          body,
          `/${item.id}`,
          1,
          patchKey,
        )
      ).status,
    ).toBe(200);
    await error(
      await request(project, "PATCH", member, body, `/${item.id}`, 2, patchKey),
      409,
    );
    await error(
      await request(project, "PATCH", member, body, `/${item.id}`, 1),
      409,
      "TASK_VERSION_CONFLICT",
    );
    await removeMember(client.sql, project.projectId, member.userId);
    await error(
      await request(project, "POST", member, body, "", undefined, key),
      404,
    );
  });
  it("allocates unique project task numbers under concurrent creation", async () => {
    const { project, member } = await fixture();
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        request(project, "POST", member, edit(member.userId)),
      ),
    );
    for (const response of results)
      expect(response.status, await response.clone().text()).toBe(200);
    const items = await Promise.all(
      results.map(async (r) => taskItemSchema.parse(await r.json())),
    );
    expect(new Set(items.map((i) => i.code)).size).toBe(12);
  });
  for (const failure of [
    "audit",
    "activity",
    "search",
    "notification",
  ] as const)
    it(`rolls back business/history/sequence/idempotency and all projections on ${failure} failure`, async () => {
      const { project, member } = await fixture();
      const spy =
        failure === "audit"
          ? vi.spyOn(audit, "append")
          : failure === "activity"
            ? vi.spyOn(activity, "append")
            : failure === "search"
              ? vi.spyOn(search, "upsert")
              : vi.spyOn(notifications, "write");
      spy.mockRejectedValueOnce(new Error("injected storage failure"));
      await error(
        await request(project, "POST", member, edit(member.userId)),
        500,
      );
      expect(
        await client.sql`SELECT 1 FROM app.tasks WHERE project_id=${project.projectId}`,
      ).toHaveLength(0);
      expect(
        await client.sql`SELECT 1 FROM app.code_sequences WHERE project_id=${project.projectId} AND entity_type='TASK'`,
      ).toHaveLength(0);
      expect(
        await client.sql`SELECT 1 FROM app.notifications WHERE project_id=${project.projectId}`,
      ).toHaveLength(0);
      expect(
        await client.sql`SELECT 1 FROM app.search_projection WHERE project_id=${project.projectId} AND entity_type='TASK'`,
      ).toHaveLength(0);
      expect(
        await client.sql`SELECT 1 FROM app.idempotency_records WHERE actor_id=${member.userId}`,
      ).toHaveLength(0);
      expect(
        await client.sql`SELECT 1 FROM app.task_status_history WHERE project_id=${project.projectId}`,
      ).toHaveLength(0);
      expect(
        await client.sql`SELECT 1 FROM app.activity_projection WHERE project_id=${project.projectId}`,
      ).toHaveLength(0);
      expect(
        await auditReader.sql`SELECT 1 FROM app.audit_logs WHERE project_id=${project.projectId}`,
      ).toHaveLength(0);
    });
});
