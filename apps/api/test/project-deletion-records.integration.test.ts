import "reflect-metadata";
import { randomBytes } from "node:crypto";

import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { schemaRegistry } from "@inpulse/api-contract";
import {
  createDatabaseClient,
  type DatabaseClient,
} from "@inpulse/database/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { VersionedHmacKeyring } from "../src/auth/keyring.js";
import { SessionAuthService } from "../src/auth/session-auth.service.js";
import { SessionTokenService } from "../src/auth/session-token.service.js";
import { PostgresUserSessionRepository } from "../src/auth/user-session.repository.js";
import { TimeCursorService } from "../src/cursors/time-cursor.js";
import { PostgresUnitOfWork } from "../src/database/unit-of-work.js";
import { ApiExceptionFilter } from "../src/http/api-exception.filter.js";
import { ContractResponseInterceptor } from "../src/http/contract-response.interceptor.js";
import { ProjectDeletionsController } from "../src/modules/projects/project-deletions.controller.js";
import {
  PROJECT_DELETION_CURSOR_NAMESPACE,
  ProjectDeletionsQueryService,
} from "../src/modules/projects/project-deletions.query.service.js";
import { createProject, createUser, testUrls } from "./database.helpers.js";

let client: DatabaseClient;
let app: INestApplication | undefined;
let base: string;

const cursorKey = randomBytes(32);
const tokens = new SessionTokenService(
  VersionedHmacKeyring.fromEntries([{ version: 1, key: cursorKey }], 1),
);

interface Actor {
  readonly userId: number;
  readonly cookie: string;
}

interface Fixture {
  readonly owner: Actor;
  readonly projectId: number;
  readonly code: string;
  readonly name: string;
}

async function actor(admin = false): Promise<Actor> {
  const userId = await createUser(client.sql, { admin });
  const cookie = randomBytes(32).toString("base64url");
  await client.sql.begin(async (transaction) => {
    const [session] = await transaction<Array<{ id: number }>>`
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
    await transaction`
      INSERT INTO app.session_csrf_tokens (session_id, token_hash, expires_at)
      VALUES (
        ${session!.id},
        ${tokens.hash(randomBytes(32).toString("base64url")).hash},
        now() + interval '1 hour'
      )
    `;
  });
  return { userId, cookie: `__Host-session=${cookie}` };
}

/** 直接按软删除标记落库，夹具不需要复述删除接口的整条命令链。 */
async function fixture(): Promise<Fixture> {
  const owner = await actor();
  const project = await createProject(client.sql, owner.userId);
  const name = `Project ${project.code}`;
  await client.sql`
    UPDATE app.projects
       SET deleted_at = now(),
           deleted_by = ${owner.userId},
           row_version = row_version + 1
     WHERE id = ${project.projectId}
  `;
  return {
    owner,
    projectId: project.projectId,
    code: project.code,
    name,
  };
}

async function read(who: Actor | undefined, query = ""): Promise<Response> {
  return fetch(`${base}/api/v1/project-deletions${query}`, {
    method: "GET",
    headers: {
      origin: base,
      "sec-fetch-site": "same-origin",
      ...(who === undefined ? {} : { cookie: who.cookie }),
    },
  });
}

interface LedgerPage {
  readonly items: readonly {
    readonly projectId: number;
    readonly code: string;
    readonly name: string;
    readonly deletedAt: string;
    readonly deletedBy: { readonly id: number; readonly name: string };
    readonly canRestore: boolean;
    readonly canPurge: boolean;
  }[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

async function page(who: Actor | undefined, query = ""): Promise<LedgerPage> {
  const response = await read(who, query);
  expect(response.status).toBe(200);
  return schemaRegistry.ProjectDeletionPage.schema.parse(
    (await response.json()) as unknown,
  ) as unknown as LedgerPage;
}

/** 台账里的删除人必须真实可查，不能只回一个 ID。 */
async function userName(userId: number): Promise<string> {
  const rows = await client.sql<Array<{ name: string }>>`
    SELECT name FROM app.users WHERE id = ${userId}
  `;
  return rows[0]!.name;
}

async function expectError(
  response: Response,
  status: number,
  code: string,
): Promise<void> {
  expect(response.status).toBe(status);
  const body = schemaRegistry.ErrorResponse.schema.parse(
    (await response.json()) as unknown,
  );
  expect(body.code).toBe(code);
  expect(response.headers.get("x-request-id")).toBe(body.requestId);
}

beforeAll(async () => {
  const urls = testUrls();
  client = createDatabaseClient(urls.runtime, {
    applicationName: "inpulse-adr050-project-deletions",
  });

  const keyring = VersionedHmacKeyring.fromEntries(
    [{ version: 1, key: cursorKey }],
    1,
  );
  const service = new ProjectDeletionsQueryService(
    client.sql,
    new TimeCursorService(keyring, PROJECT_DELETION_CURSOR_NAMESPACE),
  );
  const auth = new SessionAuthService(
    new PostgresUnitOfWork(client),
    new PostgresUserSessionRepository(),
    tokens,
  );

  class TestModule {}
  Module({
    controllers: [ProjectDeletionsController],
    providers: [
      { provide: SessionAuthService, useValue: auth },
      { provide: ProjectDeletionsQueryService, useValue: service },
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
});

describe("ADR-050 project deletion ledger API", () => {
  it("匿名读取 401，不返回任何删除记录", async () => {
    const response = await read(undefined);
    await expectError(response, 401, "PROJECT_SESSION_REQUIRED");
  });

  it("任何登录用户可读，且只返回删除台账字段（谁、何时、哪个项目）", async () => {
    const value = await fixture();
    const stranger = await actor();

    // 无关用户没有任何项目成员关系，仍能看到删除记录，但看不到项目内容。
    const body = await page(stranger);
    const item = body.items.find((row) => row.projectId === value.projectId);
    expect(item).toBeDefined();
    expect(Object.keys(item!).sort()).toEqual([
      "canPurge",
      "canRestore",
      "code",
      "deletedAt",
      "deletedBy",
      "name",
      "projectId",
    ]);
    expect(Object.keys(item!.deletedBy).sort()).toEqual(["id", "name"]);
    expect(item!.code).toBe(value.code);
    expect(item!.name).toBe(value.name);
    // 无关用户既不是组长也不是系统管理员，台账照常可见但没有还原 / 彻底删除入口。
    expect(item!.canRestore).toBe(false);
    expect(item!.canPurge).toBe(false);
    expect(item!.deletedBy.id).toBe(value.owner.userId);
    expect(item!.deletedBy.name).toBe(await userName(value.owner.userId));
    expect(item!.deletedBy.name.length).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(item!.deletedAt))).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(
      /description|memberCount|status|eventPayload|stack/i,
    );
  });

  it("未删除项目不出现在删除台账里", async () => {
    const owner = await actor();
    const alive = await createProject(client.sql, owner.userId);
    const body = await page(owner);
    expect(body.items.some((row) => row.projectId === alive.projectId)).toBe(
      false,
    );
  });

  it("台账按当前身份标注还原 / 彻底删除入口：组长可还原、系统管理员可彻底删除", async () => {
    const value = await fixture();
    const admin = await actor(true);

    // 创建者是本项目组长：能还原，但不能彻底删除。
    const forOwner = (await page(value.owner)).items.find(
      (row) => row.projectId === value.projectId,
    );
    expect(forOwner?.canRestore).toBe(true);
    expect(forOwner?.canPurge).toBe(false);

    // 系统管理员两个入口都有（还原仍走同一命令）。
    const forAdmin = (await page(admin)).items.find(
      (row) => row.projectId === value.projectId,
    );
    expect(forAdmin?.canRestore).toBe(true);
    expect(forAdmin?.canPurge).toBe(true);
  });

  it("按删除时间倒序、签名游标分页不重不漏", async () => {
    const older = await fixture();
    const newer = await fixture();
    const reader = await actor();

    const first = await page(reader, "?limit=1");
    expect(first.items.length).toBe(1);
    // 台账是全局的，每页 1 条时必然还有下一页（刚删了两个项目）。
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).not.toBeNull();
    // 较旧的删除不可能排在第一页。
    expect(first.items.map((row) => row.projectId)).not.toContain(
      older.projectId,
    );

    const rest: Array<{
      readonly projectId: number;
      readonly deletedAt: string;
    }> = [];
    let cursor: string | null = first.nextCursor;
    for (let hop = 0; hop < 200 && cursor !== null; hop += 1) {
      const next: LedgerPage = await page(
        reader,
        `?limit=20&cursor=${encodeURIComponent(cursor)}`,
      );
      rest.push(
        ...next.items.map((row) => ({
          projectId: row.projectId,
          deletedAt: row.deletedAt,
        })),
      );
      if (!next.hasMore) {
        // 末页不给游标，客户端不会再多取一次。
        expect(next.nextCursor).toBeNull();
        cursor = null;
      } else {
        expect(next.nextCursor).not.toBeNull();
        cursor = next.nextCursor;
      }
    }

    const walked = [...first.items, ...rest];
    // 不重不漏：跨页无重复，首页那条也不会在后续页重复出现。
    const ids = walked.map((row) => row.projectId);
    expect(new Set(ids).size).toBe(ids.length);
    // 全局倒序：相邻两条的删除时间不递增（删完一页继续删也只可能更早）。
    for (let index = 1; index < walked.length; index += 1) {
      expect(walked[index - 1]!.deletedAt >= walked[index]!.deletedAt).toBe(
        true,
      );
    }
    // 刚删的两个项目都在台账里，且新的排在旧的之前。
    expect(ids).toContain(older.projectId);
    expect(ids).toContain(newer.projectId);
    expect(ids.indexOf(newer.projectId)).toBeLessThan(
      ids.indexOf(older.projectId),
    );
  });

  it("游标绑定操作者：换个人使用同一游标 422", async () => {
    await fixture();
    const owner = await actor();
    const other = await actor();
    const first = await page(owner, "?limit=1");
    expect(first.nextCursor).not.toBeNull();

    const stolen = await read(
      other,
      `?limit=1&cursor=${encodeURIComponent(first.nextCursor!)}`,
    );
    await expectError(stolen, 422, "PROJECT_DELETION_VALIDATION_FAILED");
  });

  it("非法游标与超限 limit 一律 422", async () => {
    const reader = await actor();
    // 无法验签的游标由服务层拒绝；limit 超限由契约查询 Schema 拒绝。
    await expectError(
      await read(
        reader,
        `?limit=20&cursor=${encodeURIComponent("not-a-cursor")}`,
      ),
      422,
      "PROJECT_DELETION_VALIDATION_FAILED",
    );
    await expectError(
      await read(reader, "?limit=51"),
      422,
      "VALIDATION_FAILED",
    );
  });
});
