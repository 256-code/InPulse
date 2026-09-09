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
  const uow = new PostgresUnitOfWork(client);
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
      status: "ACTIVE",
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
});
