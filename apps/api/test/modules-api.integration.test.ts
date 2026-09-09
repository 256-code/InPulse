import "reflect-metadata";
import { randomBytes, randomUUID } from "node:crypto";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  createDatabaseClient,
  type DatabaseClient,
} from "@inpulse/database/client";
import {
  moduleItemSchema,
  moduleListResponseSchema,
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
import { PostgresUserCredentialRepository } from "../src/auth/user-credential.repository.js";
import { AuthenticatedMutationService } from "../src/auth/authenticated-mutation.service.js";
import { AdminHighRiskAuthService } from "../src/auth/admin-high-risk.service.js";
import { PostgresUnitOfWork } from "../src/database/unit-of-work.js";
import { PostgresAuditWritePort } from "../src/audit/postgres-audit-write-port.js";
import { IdempotencyHttpService } from "../src/idempotency/http-service.js";
import { IdempotencyRunner } from "../src/idempotency/runner.js";
import { PostgresIdempotencyStore } from "../src/idempotency/store.js";
import { resolveRegisteredRoute } from "../src/idempotency/route.js";
import { PostgresProjectAccessQueryPort } from "../src/modules/projects/postgres-project-access-query-port.js";
import { PostgresActivityWritePort } from "../src/modules/activity/postgres-activity-write-port.js";
import { PostgresSearchProjectionWritePort } from "../src/modules/search/postgres-search-projection-write-port.js";
import { ModuleManagementRepository } from "../src/modules/modules/module-management.repository.js";
import { ModulesManagementService } from "../src/modules/modules/modules-management.service.js";
import { ModulesHttpService } from "../src/modules/modules/modules-http.service.js";
import { ModulesController } from "../src/modules/modules/modules.controller.js";
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
let management: ModulesManagementService;
let audit: PostgresAuditWritePort;
let search: PostgresSearchProjectionWritePort;
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
    applicationName: "inpulse-f12-http",
  });
  auditReader = createDatabaseClient(testUrls().auditReader, {
    applicationName: "inpulse-f12-audit-evidence",
  });
  uow = new PostgresUnitOfWork(client);
  const sessions = new PostgresUserSessionRepository();
  const csrf = new PostgresSessionCsrfTokenRepository();
  const auth = new SessionAuthService(uow, sessions, tokens);
  audit = new PostgresAuditWritePort({ currentVersion: 1, keyFor: () => key });
  search = new PostgresSearchProjectionWritePort();
  management = new ModulesManagementService(
    new PostgresProjectAccessQueryPort(client),
    uow,
    new ModuleManagementRepository(),
    audit,
    new PostgresActivityWritePort(),
    search,
  );
  const http = new ModulesHttpService(
    auth,
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
    management,
  );
  class TestModule {}
  Module({
    controllers: [ModulesController],
    providers: [{ provide: ModulesHttpService, useValue: http }],
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
async function fixture(): Promise<{ member: Actor; project: ProjectFixture }> {
  const member = await actor();
  return { member, project: await createProject(client.sql, member.userId) };
}
async function request(
  projectId: number,
  method: string,
  who?: Actor,
  body?: unknown,
  suffix = "",
  version?: number,
  idempotencyKey = randomUUID(),
) {
  return fetch(`${base}/api/v1/projects/${projectId}/modules${suffix}`, {
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
  });
}
async function error(response: Response, status: number, code?: string) {
  expect(response.status).toBe(status);
  const body = schemaRegistry.ErrorResponse.schema.parse(await response.json());
  if (code) expect(body.code).toBe(code);
  expect(JSON.stringify(body)).not.toMatch(
    /INSERT INTO|SELECT |stack|constraint_name/,
  );
}

describe("F-12 real HTTP + PostgreSQL", () => {
  it("creates NORMAL, edits UNCLASSIFIED, exposes only contract DTOs and keeps sort order", async () => {
    const { member, project } = await fixture();
    const created = await request(project.projectId, "POST", member, {
      name: "普通",
      description: "说明",
    });
    expect(created.status).toBe(200);
    const module = moduleItemSchema.parse(await created.json());
    expect(module.kind).toBe("NORMAL");
    const updated = await request(
      project.projectId,
      "PATCH",
      member,
      { name: "新的未分类名称", description: "允许修改" },
      `/${project.moduleId}`,
      1,
    );
    expect(updated.status).toBe(200);
    expect(moduleItemSchema.parse(await updated.json())).toMatchObject({
      kind: "UNCLASSIFIED",
      rowVersion: 2,
    });
    const listing = await request(project.projectId, "GET", member);
    expect(listing.status).toBe(200);
    const items = moduleListResponseSchema.parse(await listing.json()).items;
    expect(items.map((item) => item.id)).toEqual([project.moduleId, module.id]);
  });
  it("maps normalized duplicate names and stale versions to safe 409; rejects identity injection", async () => {
    const { member, project } = await fixture();
    expect(
      (await request(project.projectId, "POST", member, { name: "Catalog" }))
        .status,
    ).toBe(200);
    await error(
      await request(project.projectId, "POST", member, { name: " catalog " }),
      409,
      "MODULE_NAME_CONFLICT",
    );
    await error(
      await request(
        project.projectId,
        "PATCH",
        member,
        { name: "旧版本" },
        `/${project.moduleId}`,
        2,
      ),
      409,
      "MODULE_VERSION_CONFLICT",
    );
    await error(
      await request(project.projectId, "POST", member, {
        name: "非法身份",
        kind: "UNCLASSIFIED",
      }),
      422,
    );
    await error(
      await request(
        project.projectId,
        "PATCH",
        member,
        { name: "漏版本" },
        `/${project.moduleId}`,
      ),
      422,
    );
  });
  it("covers anonymous, member, other project member, removed member and admin access", async () => {
    const { member, project } = await fixture();
    const other = await fixture();
    const admin = await actor(true);
    await error(await request(project.projectId, "GET"), 401);
    await error(
      await request(project.projectId, "POST", undefined, { name: "匿名" }),
      401,
    );
    await error(await request(project.projectId, "GET", other.member), 404);
    await error(
      await request(
        other.project.projectId,
        "PATCH",
        member,
        { name: "错误归属" },
        `/${project.moduleId}`,
        1,
      ),
      404,
    );
    expect((await request(project.projectId, "GET", admin)).status).toBe(200);
    await removeMember(client.sql, project.projectId, member.userId);
    await error(await request(project.projectId, "GET", member), 404);
    await error(
      await request(project.projectId, "POST", member, { name: "移除后" }),
      404,
    );
  });
  it("requires admin reauth and reason, preserves archived reads, rejects archived edit, restores without changing kind", async () => {
    const { member, project } = await fixture();
    const admin = await actor(true);
    await error(
      await request(
        project.projectId,
        "POST",
        member,
        { reason: "归档" },
        `/${project.moduleId}/archive`,
        1,
      ),
      403,
    );
    await error(
      await request(
        project.projectId,
        "POST",
        admin,
        { reason: " " },
        `/${project.moduleId}/archive`,
        1,
      ),
      422,
    );
    const archived = await request(
      project.projectId,
      "POST",
      admin,
      { reason: "暂时停用" },
      `/${project.moduleId}/archive`,
      1,
    );
    expect(archived.status).toBe(200);
    expect(moduleItemSchema.parse(await archived.json())).toMatchObject({
      status: "ARCHIVED",
      rowVersion: 2,
    });
    expect((await request(project.projectId, "GET", member)).status).toBe(200);
    await error(
      await request(
        project.projectId,
        "PATCH",
        member,
        { name: "不可编辑" },
        `/${project.moduleId}`,
        2,
      ),
      409,
      "MODULE_STATE_CONFLICT",
    );
    const restored = await request(
      project.projectId,
      "POST",
      admin,
      { reason: "重新启用" },
      `/${project.moduleId}/restore`,
      2,
    );
    expect(restored.status).toBe(200);
    expect(moduleItemSchema.parse(await restored.json())).toMatchObject({
      status: "ACTIVE",
      kind: "UNCLASSIFIED",
      archivedAt: null,
      rowVersion: 3,
    });
    await client.sql`UPDATE app.user_sessions SET reauthenticated_at = now() - interval '6 minutes' WHERE id = ${admin.sessionId}`;
    await error(
      await request(
        project.projectId,
        "POST",
        admin,
        { reason: "过期" },
        `/${project.moduleId}/archive`,
        3,
      ),
      403,
      "ADMIN_REAUTH_REQUIRED",
    );
  });
  it("replays equivalent normalized requests, rejects changed input and removed membership", async () => {
    const { member, project } = await fixture();
    const key = randomUUID();
    const first = await request(
      project.projectId,
      "POST",
      member,
      { name: "幂等" },
      "",
      undefined,
      key,
    );
    expect(first.status).toBe(200);
    const body = await first.json();
    const replay = await request(
      project.projectId,
      "POST",
      member,
      { name: " 幂等 ", description: "" },
      "",
      undefined,
      key,
    );
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(body);
    await error(
      await request(
        project.projectId,
        "POST",
        member,
        { name: "不同" },
        "",
        undefined,
        key,
      ),
      409,
      "IDEMPOTENCY_REQUEST_MISMATCH",
    );
    await removeMember(client.sql, project.projectId, member.userId);
    await error(
      await request(
        project.projectId,
        "POST",
        member,
        { name: "幂等" },
        "",
        undefined,
        key,
      ),
      404,
    );
  });
  it("requires fresh reauth on replay and rejects archived parent writes while retaining history", async () => {
    const { member, project } = await fixture();
    const admin = await actor(true);
    const key = randomUUID();
    const suffix = `/${project.moduleId}/archive`;
    expect(
      (
        await request(
          project.projectId,
          "POST",
          admin,
          { reason: "封存" },
          suffix,
          1,
          key,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          project.projectId,
          "POST",
          admin,
          { reason: "封存" },
          suffix,
          1,
          key,
        )
      ).status,
    ).toBe(200);
    await client.sql`UPDATE app.user_sessions SET mfa_verified_at = now() - interval '6 minutes' WHERE id = ${admin.sessionId}`;
    await error(
      await request(
        project.projectId,
        "POST",
        admin,
        { reason: "封存" },
        suffix,
        1,
        key,
      ),
      403,
    );
    await client.sql`UPDATE app.projects SET status = 'ARCHIVED', archived_at = now(), row_version = row_version + 1 WHERE id = ${project.projectId}`;
    expect((await request(project.projectId, "GET", member)).status).toBe(200);
    await error(
      await request(project.projectId, "POST", member, { name: "归档父级" }),
      409,
      "MODULE_PROJECT_ARCHIVED",
    );
    await error(
      await request(
        project.projectId,
        "POST",
        admin,
        { reason: "恢复" },
        `/${project.moduleId}/restore`,
        2,
      ),
      409,
      "MODULE_PROJECT_ARCHIVED",
    );
  });
  it.each(["audit", "search"] as const)(
    "rolls back business, audit, projections and idempotency after %s failure",
    async (failure) => {
      const { member, project } = await fixture();
      const key = randomUUID();
      if (failure === "audit")
        vi.spyOn(audit, "append").mockRejectedValueOnce(
          new Error("internal fixture failure"),
        );
      else
        vi.spyOn(search, "upsert").mockRejectedValueOnce(
          new Error("internal fixture failure"),
        );
      await error(
        await request(
          project.projectId,
          "POST",
          member,
          { name: "全部回滚" },
          "",
          undefined,
          key,
        ),
        500,
      );
      const [counts] =
        await client.sql`SELECT (SELECT count(*)::int FROM app.modules WHERE project_id = ${project.projectId}) AS modules, (SELECT count(*)::int FROM app.activity_projection WHERE project_id = ${project.projectId}) AS activities, (SELECT count(*)::int FROM app.search_projection WHERE project_id = ${project.projectId}) AS search, (SELECT count(*)::int FROM app.idempotency_records WHERE idempotency_key = ${key}) AS idempotency`;
      expect(counts).toEqual({
        modules: 1,
        activities: 0,
        search: 0,
        idempotency: 0,
      });
      const audits =
        await auditReader.sql`SELECT action FROM app.audit_logs WHERE project_id = ${project.projectId}`;
      expect(audits).toHaveLength(0);
      expect(
        (
          await request(
            project.projectId,
            "POST",
            member,
            { name: "全部回滚" },
            "",
            undefined,
            key,
          )
        ).status,
      ).toBe(200);
    },
  );
  it("parent archive FOR UPDATE blocks a child write, which rechecks ACTIVE after acquiring its lock", async () => {
    const { member, project } = await fixture();
    let release!: () => void;
    let acquired!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const parent = uow.run(async (tx) => {
      await tx.sql`SELECT id FROM app.projects WHERE id = ${project.projectId} FOR UPDATE`;
      acquired();
      await gate;
      await tx.sql`UPDATE app.projects SET status = 'ARCHIVED', archived_at = now(), row_version = row_version + 1 WHERE id = ${project.projectId}`;
    });
    await ready;
    const child = request(project.projectId, "POST", member, {
      name: "竞争写入",
    });
    try {
      await vi.waitFor(
        async () => {
          const rows =
            await client.sql`SELECT pid FROM pg_stat_activity WHERE application_name = 'inpulse-f12-http' AND wait_event_type = 'Lock'`;
          expect(rows.length).toBeGreaterThan(0);
        },
        { timeout: 4000, interval: 30 },
      );
    } finally {
      release();
      await parent;
    }
    await error(await child, 409, "MODULE_PROJECT_ARCHIVED");
    expect(
      (await management.list(member.userId, project.projectId)).items,
    ).toHaveLength(1);
  });
});
