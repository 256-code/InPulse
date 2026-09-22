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

import { AuthenticatedMutationService } from "../src/auth/authenticated-mutation.service.js";
import { AdminHighRiskAuthService } from "../src/auth/admin-high-risk.service.js";
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
import { PostgresProjectAccessQueryPort } from "../src/modules/projects/postgres-project-access-query-port.js";
import { PostgresNotificationWritePort } from "../src/modules/notifications/postgres-notification-write-port.js";
import { PostgresProjectMembersQueryPort } from "../src/modules/projects/postgres-project-members-query-port.js";
import { ProjectRoleGateService } from "../src/modules/projects/project-role-gate.service.js";
import { ProjectStartNotifier } from "../src/modules/projects/project-start.notifier.js";
import { PostgresProjectArchiveRequestRepository } from "../src/modules/projects/postgres-project-archive-request.repository.js";
import { PostgresProjectsWritePort } from "../src/modules/projects/postgres-projects-write-port.js";
import { ProjectManagementController } from "../src/modules/projects/project-management.controller.js";
import { ProjectManagementHttpService } from "../src/modules/projects/project-management-http.service.js";
import { ProjectManagementService } from "../src/modules/projects/project-management.service.js";
import { PostgresSearchProjectionWritePort } from "../src/modules/search/postgres-search-projection-write-port.js";
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
  const admin = await actor(true);
  const owner = await actor(false);
  const project = await createProject(client.sql, owner.userId);
  return { admin, owner, project };
}

async function request(
  method: string,
  path: string,
  who?: Actor,
  body?: unknown,
  options: {
    readonly key?: string;
    readonly csrf?: string;
    readonly omitCsrf?: boolean;
    readonly omitIdempotency?: boolean;
    readonly omitIfMatch?: boolean;
    readonly contentType?: string;
    readonly ifMatch?: string;
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
    applicationName: "inpulse-f06-project-management",
  });
  auditReader = createDatabaseClient(testUrls().auditReader, {
    applicationName: "inpulse-f06-project-management-audit",
  });
  const uow = new PostgresUnitOfWork(client);
  const csrf = new PostgresSessionCsrfTokenRepository();
  const sessions = new PostgresUserSessionRepository();
  const auth = new SessionAuthService(uow, sessions, tokens);
  const highRisk = new AdminHighRiskAuthService(
    sessions,
    csrf,
    tokens,
    new PostgresUserCredentialRepository(),
  );
  const service = new ProjectManagementService(
    new PostgresProjectsWritePort(),
    new PostgresProjectAccessQueryPort(client),
    new PostgresAuditWritePort({ currentVersion: 1, keyFor: () => key }),
    new PostgresActivityWritePort(),
    new PostgresSearchProjectionWritePort(),
    new PostgresProjectMembersQueryPort(),
    new PostgresProjectArchiveRequestRepository(),
    new ProjectRoleGateService(
      new PostgresProjectAccessQueryPort(client),
      new PostgresProjectMembersQueryPort(),
    ),
    new ProjectStartNotifier(
      new PostgresProjectMembersQueryPort(),
      new PostgresNotificationWritePort(),
    ),
  );
  const http = new ProjectManagementHttpService(
    auth,
    new AuthenticatedMutationService(auth, csrf, tokens),
    highRisk,
    uow,
    new IdempotencyHttpService(
      new IdempotencyRunner(uow, new PostgresIdempotencyStore()),
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

describe("F-06.1 project edit API", () => {
  it("edits a project with audit, activity, search projection and idempotent replay", async () => {
    const value = await fixture();
    const editKey = randomUUID();
    const path = `/projects/${value.project.projectId}`;
    const editBody = { name: "  商城系统二期  ", description: "新的项目描述" };

    const edited = await request("PATCH", path, value.owner, editBody, {
      key: editKey,
    });
    expect(edited.status).toBe(200);
    const body = schemaRegistry.ProjectDetailResponse.schema.parse(
      await edited.json(),
    );
    expect(body.project).toMatchObject({
      id: value.project.projectId,
      code: value.project.code,
      name: "商城系统二期",
      description: "新的项目描述",
      status: "NOT_STARTED",
      rowVersion: 2,
      memberCount: 1,
      stats: {
        activeModuleCount: 1,
        activeFeatureCount: 0,
        openTaskCount: 0,
        completedTaskCount: 0,
      },
    });

    const replay = await request("PATCH", path, value.owner, editBody, {
      key: editKey,
    });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(body);

    const auditRows = (await auditReader.sql`
      SELECT action AS "action",
             target_id AS "targetId"
        FROM app.audit_logs
       WHERE project_id = ${value.project.projectId}
         AND action = 'project.update'
    `) as unknown as readonly { action: string; targetId: string }[];
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]!.targetId).toBe(String(value.project.projectId));

    const activityRows = (await client.sql`
      SELECT activity_type AS "activityType",
             source_row_version AS "sourceRowVersion"
        FROM app.activity_projection
       WHERE project_id = ${value.project.projectId}
         AND activity_type = 'PROJECT_UPDATED'
    `) as unknown as readonly {
      activityType: string;
      sourceRowVersion: number;
    }[];
    expect(activityRows).toHaveLength(1);
    expect(activityRows[0]!.sourceRowVersion).toBe(2);

    const searchRows = (await client.sql`
      SELECT title, summary
        FROM app.search_projection
       WHERE project_id = ${value.project.projectId}
         AND entity_type = 'PROJECT'
         AND entity_id = ${value.project.projectId}
    `) as unknown as readonly { title: string; summary: string }[];
    expect(searchRows).toHaveLength(1);
    expect(searchRows[0]).toMatchObject({
      title: "商城系统二期",
      summary: "新的项目描述",
    });
  });

  it("rejects anonymous, non-member, stale version and archived writes", async () => {
    const value = await fixture();
    const outsider = await actor(false);
    const path = `/projects/${value.project.projectId}`;
    const editBody = { name: "受保护的项目", description: "" };

    await expectError(
      await request("PATCH", path, undefined, editBody, {
        csrf: "a".repeat(43),
      }),
      401,
      "PROJECT_SESSION_REQUIRED",
    );
    await expectError(
      await request("PATCH", path, outsider, editBody),
      404,
      "PROJECT_NOT_FOUND",
    );

    const first = await request("PATCH", path, value.owner, editBody);
    expect(first.status).toBe(200);
    await expectError(
      await request("PATCH", path, value.owner, {
        name: "并发覆盖",
        description: "",
      }),
      409,
      "PROJECT_VERSION_CONFLICT",
    );

    await client.sql`
      UPDATE app.projects
         SET status = 'ARCHIVED',
             archived_at = now(),
             row_version = row_version + 1
       WHERE id = ${value.project.projectId}
    `;
    await expectError(
      await request(
        "PATCH",
        path,
        value.owner,
        { name: "归档后编辑", description: "" },
        { ifMatch: '"2"' },
      ),
      409,
      "PROJECT_ARCHIVED",
    );
  });

  it("validates protocol headers, content type, body and idempotency key", async () => {
    const value = await fixture();
    const path = `/projects/${value.project.projectId}`;
    const editBody = { name: "协议校验", description: "" };

    await expectError(
      await request("PATCH", path, value.owner, editBody, {
        omitIfMatch: true,
      }),
      422,
      "PROJECT_VALIDATION_FAILED",
    );
    await expectError(
      await request("PATCH", path, value.owner, editBody, {
        omitCsrf: true,
      }),
      422,
      "PROJECT_VALIDATION_FAILED",
    );
    await expectError(
      await request("PATCH", path, value.owner, editBody, {
        ifMatch: "1",
      }),
      422,
      "PROJECT_VALIDATION_FAILED",
    );
    await expectError(
      await request("PATCH", path, value.owner, editBody, {
        contentType: "text/plain",
      }),
      400,
      "PROJECT_CONTENT_TYPE_INVALID",
    );
    await expectError(
      await request("PATCH", path, value.owner, editBody, {
        omitIdempotency: true,
      }),
      400,
      "IDEMPOTENCY_KEY_REQUIRED",
    );
    await expectError(
      await request("PATCH", path, value.owner, {
        name: "   ",
        description: "",
      }),
      422,
      "PROJECT_VALIDATION_FAILED",
    );
  });

  it("rechecks current authorization before replaying a cached success", async () => {
    const removed = await fixture();
    const removedKey = randomUUID();
    const removedPath = `/projects/${removed.project.projectId}`;
    const editBody = { name: "重放授权", description: "" };
    const first = await request("PATCH", removedPath, removed.owner, editBody, {
      key: removedKey,
    });
    expect(first.status).toBe(200);
    await client.sql`
      UPDATE app.project_members
         SET status = 'REMOVED',
             removed_at = now(),
             role = 'MEMBER'
       WHERE project_id = ${removed.project.projectId}
         AND user_id = ${removed.owner.userId}
         AND status = 'ACTIVE'
    `;
    await expectError(
      await request("PATCH", removedPath, removed.owner, editBody, {
        key: removedKey,
      }),
      404,
      "PROJECT_NOT_FOUND",
    );

    const archived = await fixture();
    const archivedKey = randomUUID();
    const archivedPath = `/projects/${archived.project.projectId}`;
    const archivedFirst = await request(
      "PATCH",
      archivedPath,
      archived.owner,
      editBody,
      { key: archivedKey },
    );
    expect(archivedFirst.status).toBe(200);
    await client.sql`
      UPDATE app.projects
         SET status = 'ARCHIVED',
             archived_at = now(),
             row_version = row_version + 1
       WHERE id = ${archived.project.projectId}
    `;
    await expectError(
      await request("PATCH", archivedPath, archived.owner, editBody, {
        key: archivedKey,
      }),
      409,
      "PROJECT_ARCHIVED",
    );
  });
});

describe("F-06.2 project archive API", () => {
  it("archives an ACTIVE project with reason, audit, activity, search projection and idempotent replay", async () => {
    const value = await fixture();
    const path = `/projects/${value.project.projectId}/archive`;
    const archiveKey = randomUUID();
    const archiveBody = { reason: "项目已交付，暂停迭代" };

    const archived = await request("POST", path, value.admin, archiveBody, {
      key: archiveKey,
    });
    expect(archived.status).toBe(200);
    const archivedBody = schemaRegistry.ProjectDetailResponse.schema.parse(
      await archived.json(),
    );
    expect(archivedBody.project).toMatchObject({
      id: value.project.projectId,
      code: value.project.code,
      status: "ARCHIVED",
      rowVersion: 2,
      memberCount: 1,
      stats: {
        activeModuleCount: 1,
        activeFeatureCount: 0,
        openTaskCount: 0,
        completedTaskCount: 0,
      },
    });

    const replay = await request("POST", path, value.admin, archiveBody, {
      key: archiveKey,
    });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(archivedBody);

    const stored = (await client.sql`
      SELECT status,
             archived_at AS "archivedAt"
        FROM app.projects
       WHERE id = ${value.project.projectId}
    `) as unknown as readonly {
      status: string;
      archivedAt: Date | null;
    }[];
    expect(stored[0]!.status).toBe("ARCHIVED");
    expect(stored[0]!.archivedAt).not.toBeNull();

    const auditRows = (await auditReader.sql`
      SELECT action AS "action",
             target_id AS "targetId"
        FROM app.audit_logs
       WHERE project_id = ${value.project.projectId}
         AND action = 'project.archive'
    `) as unknown as readonly { action: string; targetId: string }[];
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]!.targetId).toBe(String(value.project.projectId));

    const activityRows = (await client.sql`
      SELECT activity_type AS "activityType",
             source_row_version AS "sourceRowVersion"
        FROM app.activity_projection
       WHERE project_id = ${value.project.projectId}
         AND activity_type = 'PROJECT_ARCHIVED'
    `) as unknown as readonly {
      activityType: string;
      sourceRowVersion: number;
    }[];
    expect(activityRows).toHaveLength(1);
    expect(activityRows[0]!.sourceRowVersion).toBe(2);

    const searchRows = (await client.sql`
      SELECT source_status AS "sourceStatus",
             visibility_scope AS "visibilityScope",
             source_row_version AS "sourceRowVersion"
        FROM app.search_projection
       WHERE project_id = ${value.project.projectId}
         AND entity_type = 'PROJECT'
         AND entity_id = ${value.project.projectId}
    `) as unknown as readonly {
      sourceStatus: string;
      visibilityScope: string;
      sourceRowVersion: number;
    }[];
    expect(searchRows).toHaveLength(1);
    expect(searchRows[0]).toMatchObject({
      sourceStatus: "ARCHIVED",
      visibilityScope: "MEMBER",
      sourceRowVersion: 2,
    });

    await expectError(
      await request(
        "PATCH",
        `/projects/${value.project.projectId}`,
        value.owner,
        { name: "归档后编辑", description: "" },
        { ifMatch: '"2"' },
      ),
      409,
      "PROJECT_ARCHIVED",
    );
    await expectError(
      await request(
        "POST",
        path,
        value.admin,
        { reason: "重复归档" },
        { ifMatch: '"2"' },
      ),
      409,
      "PROJECT_ARCHIVED",
    );
  });

  it("previews unfinished tasks for admins and enforces admin identity gates", async () => {
    const value = await fixture();
    const outsider = await actor(false);
    const secondAdmin = await actor(true);
    const previewPath = `/projects/${value.project.projectId}/archive-preview`;

    const finishedAt = new Date();
    await client.sql.begin(async (transaction) => {
      const [unfinished] = await transaction<Array<{ id: number }>>`
        INSERT INTO app.tasks (
          project_id, module_id, scope_type, code, title, creator_id
        )
        VALUES (
          ${value.project.projectId},
          ${value.project.moduleId},
          'MODULE',
          ${`${value.project.code}-T-1`},
          '未完成任务',
          ${value.owner.userId}
        )
        RETURNING id
      `;
      await transaction`
        INSERT INTO app.task_assignees (task_id, user_id, project_id)
        VALUES (${unfinished!.id}, ${value.owner.userId}, ${value.project.projectId})
      `;
      await transaction`
        INSERT INTO app.task_status_history (
          task_id, project_id, from_work_status, to_work_status, changed_by
        )
        VALUES (
          ${unfinished!.id},
          ${value.project.projectId},
          NULL,
          'TODO',
          ${value.owner.userId}
        )
      `;
      const [finished] = await transaction<Array<{ id: number }>>`
        INSERT INTO app.tasks (
          project_id, module_id, scope_type, code, title, work_status,
          completion_note, completed_at, creator_id
        )
        VALUES (
          ${value.project.projectId},
          ${value.project.moduleId},
          'MODULE',
          ${`${value.project.code}-T-2`},
          '已完成任务',
          'DONE',
          '已完成',
          ${finishedAt.toISOString()}::timestamptz,
          ${value.owner.userId}
        )
        RETURNING id
      `;
      await transaction`
        INSERT INTO app.task_assignees (task_id, user_id, project_id)
        VALUES (${finished!.id}, ${value.owner.userId}, ${value.project.projectId})
      `;
      await transaction`
        INSERT INTO app.task_status_history (
          task_id, project_id, from_work_status, to_work_status,
          completed_at_snapshot, completion_note_snapshot, changed_by
        )
        VALUES (
          ${finished!.id},
          ${value.project.projectId},
          NULL,
          'DONE',
          ${finishedAt.toISOString()}::timestamptz,
          '已完成',
          ${value.owner.userId}
        )
      `;
    });

    const preview = await request("GET", previewPath, value.admin, undefined, {
      omitCsrf: true,
    });
    expect(preview.status).toBe(200);
    const previewBody =
      schemaRegistry.ProjectArchivePreviewResponse.schema.parse(
        await preview.json(),
      );
    expect(previewBody).toMatchObject({
      projectId: value.project.projectId,
      unfinishedTaskCount: 1,
    });

    await expectError(
      await request("GET", previewPath),
      401,
      "PROJECT_SESSION_REQUIRED",
    );
    await expectError(
      await request("GET", previewPath, value.owner),
      403,
      "ADMIN_REQUIRED",
    );
    await expectError(
      await request("GET", previewPath, outsider),
      404,
      "PROJECT_NOT_FOUND",
    );
    const secondPreview = await request("GET", previewPath, secondAdmin);
    expect(secondPreview.status).toBe(200);
    expect(
      schemaRegistry.ProjectArchivePreviewResponse.schema.parse(
        await secondPreview.json(),
      ).unfinishedTaskCount,
    ).toBe(1);

    const archived = await request(
      "POST",
      `/projects/${value.project.projectId}/archive`,
      value.admin,
      { reason: "归档后仍可预览" },
    );
    expect(archived.status).toBe(200);
    const afterArchive = await request(
      "GET",
      previewPath,
      value.admin,
      undefined,
      { omitCsrf: true },
    );
    expect(afterArchive.status).toBe(200);
    expect(
      schemaRegistry.ProjectArchivePreviewResponse.schema.parse(
        await afterArchive.json(),
      ).unfinishedTaskCount,
    ).toBe(1);
  });

  it("rejects archive from non-admin, invalid protocol and revoked session replay", async () => {
    const value = await fixture();
    const outsider = await actor(false);
    const path = `/projects/${value.project.projectId}/archive`;
    const archiveBody = { reason: "归档原因" };

    await expectError(
      await request("POST", path, undefined, archiveBody, {
        csrf: "a".repeat(43),
      }),
      401,
      "PROJECT_SESSION_REQUIRED",
    );
    await expectError(
      await request("POST", path, value.owner, archiveBody),
      403,
      "ADMIN_REQUIRED",
    );
    await expectError(
      await request("POST", path, outsider, archiveBody),
      404,
      "PROJECT_NOT_FOUND",
    );
    await expectError(
      await request("POST", path, value.admin, {}),
      422,
      "PROJECT_VALIDATION_FAILED",
    );
    await expectError(
      await request("POST", path, value.admin, { reason: "   " }),
      422,
      "PROJECT_VALIDATION_FAILED",
    );
    await expectError(
      await request("POST", path, value.admin, archiveBody, {
        omitIfMatch: true,
      }),
      422,
      "PROJECT_VALIDATION_FAILED",
    );
    await expectError(
      await request("POST", path, value.admin, archiveBody, {
        ifMatch: '"9"',
      }),
      409,
      "PROJECT_VERSION_CONFLICT",
    );

    const archiveKey = randomUUID();
    const archived = await request("POST", path, value.admin, archiveBody, {
      key: archiveKey,
    });
    expect(archived.status).toBe(200);

    await client.sql`
      UPDATE app.user_sessions
         SET revoked_at = now()
       WHERE user_id = ${value.admin.userId}
         AND revoked_at IS NULL
    `;
    await expectError(
      await request("POST", path, value.admin, archiveBody, {
        key: archiveKey,
      }),
      401,
      "PROJECT_SESSION_REQUIRED",
    );
  });

  it("cancels a pending archive request when an admin archives the project directly (ADR-034)", async () => {
    const value = await fixture();
    const pendingRows = (await client.sql`
      INSERT INTO app.project_archive_requests (project_id, requested_by, reason)
      VALUES (${value.project.projectId}, ${value.owner.userId}, '组长申请归档')
      RETURNING id
    `) as unknown as readonly { id: number }[];
    const pending = pendingRows[0]!;

    const archived = await request(
      "POST",
      `/projects/${value.project.projectId}/archive`,
      value.admin,
      { reason: "管理员直接归档" },
      { ifMatch: '"1"' },
    );
    expect(archived.status, await archived.clone().text()).toBe(200);

    const rows = (await client.sql`
      SELECT status,
             decided_by AS "decidedBy",
             decision_note AS "decisionNote"
        FROM app.project_archive_requests
       WHERE id = ${pending.id}
    `) as unknown as readonly {
      status: string;
      decidedBy: number;
      decisionNote: string | null;
    }[];
    expect(rows[0]).toMatchObject({
      status: "CANCELED",
      decidedBy: value.admin.userId,
      decisionNote: null,
    });

    const audits = (await auditReader.sql`
      SELECT event_payload AS "payload"
        FROM app.audit_logs
       WHERE project_id = ${value.project.projectId}
         AND action = 'project.archive'
    `) as unknown as readonly {
      payload: { cancelledArchiveRequestIds: readonly number[] };
    }[];
    expect(audits[0]!.payload).toMatchObject({
      cancelledArchiveRequestIds: [pending.id],
    });
  });
});

describe("F-06.3 project restore API", () => {
  it("restores an archived project, re-enables child writes and replays idempotently", async () => {
    const value = await fixture();
    const archivePath = `/projects/${value.project.projectId}/archive`;
    const restorePath = `/projects/${value.project.projectId}/restore`;

    const archived = await request("POST", archivePath, value.admin, {
      reason: "暂停迭代",
    });
    expect(archived.status).toBe(200);

    const restoreKey = randomUUID();
    const restoreBody = { reason: "项目重启" };
    const restored = await request(
      "POST",
      restorePath,
      value.admin,
      restoreBody,
      { key: restoreKey, ifMatch: '"2"' },
    );
    expect(restored.status).toBe(200);
    const restoredBody = schemaRegistry.ProjectDetailResponse.schema.parse(
      await restored.json(),
    );
    expect(restoredBody.project).toMatchObject({
      status: "ACTIVE",
      rowVersion: 3,
      stats: {
        activeModuleCount: 1,
        activeFeatureCount: 0,
        openTaskCount: 0,
        completedTaskCount: 0,
      },
    });

    const replay = await request(
      "POST",
      restorePath,
      value.admin,
      restoreBody,
      { key: restoreKey, ifMatch: '"2"' },
    );
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(restoredBody);

    const stored = (await client.sql`
      SELECT status,
             archived_at AS "archivedAt"
        FROM app.projects
       WHERE id = ${value.project.projectId}
    `) as unknown as readonly {
      status: string;
      archivedAt: Date | null;
    }[];
    expect(stored[0]!.status).toBe("ACTIVE");
    expect(stored[0]!.archivedAt).toBeNull();

    const auditRows = (await auditReader.sql`
      SELECT action
        FROM app.audit_logs
       WHERE project_id = ${value.project.projectId}
         AND action = 'project.restore'
    `) as unknown as readonly { action: string }[];
    expect(auditRows).toHaveLength(1);

    const activityRows = (await client.sql`
      SELECT source_row_version AS "sourceRowVersion"
        FROM app.activity_projection
       WHERE project_id = ${value.project.projectId}
         AND activity_type = 'PROJECT_RESTORED'
    `) as unknown as readonly { sourceRowVersion: number }[];
    expect(activityRows).toHaveLength(1);
    expect(activityRows[0]!.sourceRowVersion).toBe(3);

    const searchRows = (await client.sql`
      SELECT source_status AS "sourceStatus",
             source_row_version AS "sourceRowVersion"
        FROM app.search_projection
       WHERE project_id = ${value.project.projectId}
         AND entity_type = 'PROJECT'
         AND entity_id = ${value.project.projectId}
    `) as unknown as readonly {
      sourceStatus: string;
      sourceRowVersion: number;
    }[];
    expect(searchRows[0]).toMatchObject({
      sourceStatus: "ACTIVE",
      sourceRowVersion: 3,
    });

    const edited = await request(
      "PATCH",
      `/projects/${value.project.projectId}`,
      value.owner,
      { name: "恢复后编辑", description: "" },
      { ifMatch: '"3"' },
    );
    expect(edited.status).toBe(200);

    await expectError(
      await request("POST", restorePath, value.admin, restoreBody, {
        ifMatch: '"4"',
      }),
      409,
      "PROJECT_STATE_CONFLICT",
    );
  });

  it("rejects restore without admin identity or project access", async () => {
    const value = await fixture();
    const outsider = await actor(false);
    const archivePath = `/projects/${value.project.projectId}/archive`;
    const restorePath = `/projects/${value.project.projectId}/restore`;
    const restoreBody = { reason: "恢复原因" };

    const archived = await request("POST", archivePath, value.admin, {
      reason: "再次归档",
    });
    expect(archived.status).toBe(200);

    await expectError(
      await request("POST", restorePath, value.owner, restoreBody, {
        ifMatch: '"2"',
      }),
      403,
      "ADMIN_REQUIRED",
    );
    await expectError(
      await request("POST", restorePath, outsider, restoreBody, {
        ifMatch: '"2"',
      }),
      404,
      "PROJECT_NOT_FOUND",
    );
    await expectError(
      await request(
        "POST",
        restorePath,
        value.admin,
        { reason: "  " },
        { ifMatch: '"2"' },
      ),
      422,
      "PROJECT_VALIDATION_FAILED",
    );
  });
});

describe("F-06.3 项目状态变更 API", () => {
  const statusPath = (projectId: number) => `/projects/${projectId}/status`;

  it("组长把未开始改为进行中：写审计、活动、搜索投影并通知全体成员", async () => {
    const value = await fixture();
    const teammate = await actor(false);
    await client.sql`
      INSERT INTO app.project_members (project_id, user_id, role)
      VALUES (${value.project.projectId}, ${teammate.userId}, 'MEMBER')
    `;

    const response = await request(
      "PATCH",
      statusPath(value.project.projectId),
      value.owner,
      { status: "ACTIVE" },
      { key: randomUUID(), ifMatch: '"1"' },
    );
    expect(response.status).toBe(200);
    const body = schemaRegistry.ProjectDetailResponse.schema.parse(
      await response.json(),
    );
    expect(body.project).toMatchObject({
      id: value.project.projectId,
      status: "ACTIVE",
      hasCompletedTask: false,
      rowVersion: 2,
    });

    const audits = (await auditReader.sql`
      SELECT action AS "action"
        FROM app.audit_logs
       WHERE project_id = ${value.project.projectId}
         AND action = 'project.status.change'
    `) as unknown as readonly { action: string }[];
    expect(audits).toHaveLength(1);

    const notifications = (await client.sql`
      SELECT recipient_id AS "recipientId"
        FROM app.notifications
       WHERE project_id = ${value.project.projectId}
       ORDER BY recipient_id ASC
    `) as unknown as readonly { recipientId: number }[];
    expect(notifications.map((row) => row.recipientId)).toEqual(
      [value.owner.userId, teammate.userId].sort((left, right) => left - right),
    );
  });

  it("维护中不通知，未开始与维护中禁止越级互改", async () => {
    const value = await fixture();
    const path = statusPath(value.project.projectId);

    await expectError(
      await request(
        "PATCH",
        path,
        value.owner,
        { status: "MAINTENANCE" },
        { ifMatch: '"1"' },
      ),
      409,
      "PROJECT_STATUS_LEVEL_SKIP",
    );

    const started = await request(
      "PATCH",
      path,
      value.owner,
      { status: "ACTIVE" },
      { ifMatch: '"1"' },
    );
    expect(started.status).toBe(200);
    const maintenance = await request(
      "PATCH",
      path,
      value.owner,
      { status: "MAINTENANCE" },
      { ifMatch: '"2"' },
    );
    expect(maintenance.status).toBe(200);
    expect(
      schemaRegistry.ProjectDetailResponse.schema.parse(
        await maintenance.json(),
      ).project.status,
    ).toBe("MAINTENANCE");

    await expectError(
      await request(
        "PATCH",
        path,
        value.owner,
        { status: "NOT_STARTED" },
        { ifMatch: '"3"' },
      ),
      409,
      "PROJECT_STATUS_LEVEL_SKIP",
    );

    const notifications = (await client.sql`
      SELECT count(*)::int AS "total"
        FROM app.notifications
       WHERE project_id = ${value.project.projectId}
         AND notification_type = 'project.status.change'
    `) as unknown as readonly { total: number }[];
    expect(notifications[0]!.total).toBe(1);

    const activities = (await client.sql`
      SELECT activity_type AS "activityType"
        FROM app.activity_projection
       WHERE project_id = ${value.project.projectId}
       ORDER BY id ASC
    `) as unknown as readonly { activityType: string }[];
    expect(activities.map((row) => row.activityType)).toEqual([
      "PROJECT_STATUS_CHANGED",
      "PROJECT_STATUS_CHANGED",
    ]);
  });

  it("普通成员可改状态、非成员 404、版本冲突与同态各自返回 409", async () => {
    const value = await fixture();
    const teammate = await actor(false);
    const outsider = await actor(false);
    await client.sql`
      INSERT INTO app.project_members (project_id, user_id, role)
      VALUES (${value.project.projectId}, ${teammate.userId}, 'MEMBER')
    `;
    const path = statusPath(value.project.projectId);

    await expectError(
      await request(
        "PATCH",
        path,
        outsider,
        { status: "ACTIVE" },
        { ifMatch: '"2"' },
      ),
      404,
      "PROJECT_NOT_FOUND",
    );
    await expectError(
      await request(
        "PATCH",
        path,
        value.owner,
        { status: "ACTIVE" },
        { ifMatch: '"9"' },
      ),
      409,
      "PROJECT_VERSION_CONFLICT",
    );
    await expectError(
      await request(
        "PATCH",
        path,
        value.owner,
        { status: "NOT_STARTED" },
        { ifMatch: '"1"' },
      ),
      409,
      "PROJECT_STATE_CONFLICT",
    );
    await expectError(
      await request(
        "PATCH",
        path,
        value.owner,
        { status: "ARCHIVED" },
        { ifMatch: '"1"' },
      ),
      422,
      "PROJECT_VALIDATION_FAILED",
    );

    // ADR-039：项目内管理权全员等同，普通成员（非组长、非系统管理员）
    // 直接改状态成功。
    const memberChange = await request(
      "PATCH",
      path,
      teammate,
      { status: "ACTIVE" },
      { key: randomUUID(), ifMatch: '"1"' },
    );
    expect(memberChange.status, await memberChange.clone().text()).toBe(200);
    expect(
      schemaRegistry.ProjectDetailResponse.schema.parse(
        await memberChange.json(),
      ).project,
    ).toMatchObject({ status: "ACTIVE", rowVersion: 2 });
  });

  it("项目出现过已完成任务后不能回退未开始", async () => {
    const value = await fixture();
    const path = statusPath(value.project.projectId);

    await client.sql`
      UPDATE app.projects
         SET status = 'ACTIVE',
             first_task_completed_at = now(),
             row_version = row_version + 1
       WHERE id = ${value.project.projectId}
    `;

    await expectError(
      await request(
        "PATCH",
        path,
        value.owner,
        { status: "NOT_STARTED" },
        { ifMatch: '"2"' },
      ),
      409,
      "PROJECT_STATUS_NOT_STARTED_LOCKED",
    );

    // 有已完成任务只锁定「回退未开始」这一条边，其余迁移照常放行。
    const maintenance = await request(
      "PATCH",
      path,
      value.owner,
      { status: "MAINTENANCE" },
      { ifMatch: '"2"' },
    );
    expect(maintenance.status).toBe(200);
    expect(
      schemaRegistry.ProjectDetailResponse.schema.parse(
        await maintenance.json(),
      ).project,
    ).toMatchObject({ status: "MAINTENANCE", hasCompletedTask: true });
  });

  it("已归档项目拒绝状态变更，必须先恢复", async () => {
    const value = await fixture();
    const archived = await request(
      "POST",
      `/projects/${value.project.projectId}/archive`,
      value.admin,
      { reason: "本轮结束" },
      { ifMatch: '"1"' },
    );
    expect(archived.status).toBe(200);

    await expectError(
      await request(
        "PATCH",
        statusPath(value.project.projectId),
        value.owner,
        { status: "ACTIVE" },
        { ifMatch: '"2"' },
      ),
      409,
      "PROJECT_ARCHIVED",
    );
  });
});
