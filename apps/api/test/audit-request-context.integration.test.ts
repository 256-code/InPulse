/**
 * F-08 / 审计请求上下文（真实 PostgreSQL 与真实 HTTP，技术设计 §9.4）。
 * 业务链路审计此前只带服务端生成的 `requestId`，客户端 IP、User-Agent 与
 * 入站 `X-Request-Id` 在源头就未采集。本文件验证改造后的语义：
 * - 请求级中间件提取三字段，审计写入端口在调用方未显式提供时兜底填充；
 * - 入站 `X-Request-Id` 只作为 `client_request_id` 留痕，绝不替换内部
 *   `request_id`（技术设计明文要求）；
 * - 未提供或形状非法时落 NULL，不得让业务写入失败（`ip_address` 是 INET
 *   列，任意字面量会直接抛错）。
 */
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  createDatabaseClient,
  type DatabaseClient,
} from "@inpulse/database/client";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { migrate } from "../../../database/src/migrate.ts";
import { generateOpaqueToken, hashOpaqueToken } from "../src/auth/token.js";
import {
  connect,
  createProject,
  createUser,
  testUrls,
  type ProjectFixture,
} from "./database.helpers.js";

const HMAC_KEY_VERSION = 1;
const SESSION_COOKIE_NAME = "__Host-session";
const FIXTURE_USER_AGENT = "InPulse-Audit-Fixture/1.0";
const CLIENT_REQUEST_ID = "audit-ctx-1.trace:alpha";

interface HttpResponse {
  readonly status: number;
  readonly body: unknown;
  readonly setCookies: readonly string[];
}

let app: INestApplication | undefined;
let baseUrl: string;
let runtime: DatabaseClient | undefined;
let sessionKey: Buffer;
let sessionKeyringDirectory: string | undefined;
let idempotencyKeyringDirectory: string | undefined;
let previousEnvironment: Record<string, string | undefined> = {};
let userId: number;
let project: ProjectFixture;

async function http(
  path: string,
  options: {
    readonly method?: string;
    readonly cookie?: string;
    readonly csrf?: string;
    readonly idempotencyKey?: string;
    readonly userAgent?: string;
    readonly clientRequestId?: string;
    readonly body?: unknown;
  } = {},
): Promise<HttpResponse> {
  const headers: Record<string, string> = {
    origin: baseUrl,
    "sec-fetch-site": "same-origin",
  };
  if (options.cookie !== undefined) {
    headers.cookie = options.cookie;
  }
  if (options.csrf !== undefined) {
    headers["x-csrf-token"] = options.csrf;
  }
  if (options.idempotencyKey !== undefined) {
    headers["Idempotency-Key"] = options.idempotencyKey;
  }
  if (options.userAgent !== undefined) {
    headers["user-agent"] = options.userAgent;
  }
  if (options.clientRequestId !== undefined) {
    headers["x-request-id"] = options.clientRequestId;
  }
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
  }
  const response = await fetch(`${baseUrl}/api/v1${path}`, {
    method: options.method ?? "GET",
    headers,
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text.length === 0 ? undefined : (JSON.parse(text) as unknown),
    setCookies: response.headers.getSetCookie(),
  };
}

async function issueCsrf(cookie: string): Promise<string> {
  const response = await http("/auth/csrf", { cookie });
  expect(response.status).toBe(200);
  return (response.body as { csrfToken: string }).csrfToken;
}

async function createSession(): Promise<string> {
  const rows = (await runtime!.sql`
    SELECT auth_version AS "authVersion"
      FROM app.users
     WHERE id = ${userId}
  `) as unknown as readonly { authVersion: number }[];
  const authVersion = rows[0]?.authVersion ?? 1;
  const token = generateOpaqueToken();
  await runtime!.sql`
    INSERT INTO app.user_sessions (
      user_id, token_hash, token_hash_key_version, auth_version_at_issue,
      auth_state, recovery_rotation_generation,
      recovery_rotation_consumed_generation, idle_expires_at,
      absolute_expires_at
    )
    VALUES (
      ${userId}, ${hashOpaqueToken(token, sessionKey)},
      ${HMAC_KEY_VERSION}, ${authVersion}, ${"AUTHENTICATED"}, 0, 0,
      now() + ${"1 hour"}::interval, now() + ${"1 day"}::interval
    )
  `;
  return `${SESSION_COOKIE_NAME}=${token}`;
}

async function createModule(
  sessionCookie: string,
  csrfToken: string,
  options: {
    readonly userAgent?: string;
    readonly clientRequestId?: string;
  } = {},
): Promise<HttpResponse> {
  return http(`/projects/${project.projectId}/modules`, {
    method: "POST",
    cookie: sessionCookie,
    csrf: csrfToken,
    idempotencyKey: randomUUID(),
    ...(options.userAgent === undefined
      ? {}
      : { userAgent: options.userAgent }),
    ...(options.clientRequestId === undefined
      ? {}
      : { clientRequestId: options.clientRequestId }),
    body: { name: `审计上下文模块 ${randomUUID().slice(0, 8)}` },
  });
}

interface AuditContextRow {
  readonly clientRequestId: string | null;
  readonly ip: string | null;
  readonly requestId: string;
  readonly userAgent: string | null;
}

/** 取本测试项目链上最新一条 `module.create`，即刚才那次业务写入。 */
async function latestModuleCreateAudit(): Promise<AuditContextRow> {
  const reader = connect(testUrls().auditReader, 2);
  try {
    const rows = (await reader`
      SELECT request_id AS "requestId",
             client_request_id AS "clientRequestId",
             host(ip_address) AS "ip",
             user_agent AS "userAgent"
        FROM app.audit_logs
       WHERE chain_id = ${`PROJECT:${project.projectId}`}
         AND action = ${"module.create"}
       ORDER BY sequence_no DESC
       LIMIT 1
    `) as unknown as readonly AuditContextRow[];
    const row = rows[0];
    if (!row) {
      throw new Error("module.create audit row missing");
    }
    return row;
  } finally {
    await reader.end();
  }
}

beforeAll(async () => {
  const urls = testUrls();
  runtime = createDatabaseClient(urls.runtime, {
    applicationName: "inpulse-audit-request-context-api-test",
  });
  await migrate(urls.migrator);

  sessionKey = randomBytes(32);
  sessionKeyringDirectory = await mkdtemp(
    join(tmpdir(), "inpulse-audit-context-session-"),
  );
  const sessionKeyringFile = join(sessionKeyringDirectory, "session.keyring");
  await writeFile(
    sessionKeyringFile,
    `1:${sessionKey.toString("hex")}\n`,
    "utf8",
  );

  idempotencyKeyringDirectory = await mkdtemp(
    join(tmpdir(), "inpulse-audit-context-idempotency-"),
  );
  const idempotencyKeyringFile = join(
    idempotencyKeyringDirectory,
    "fingerprint.keyring",
  );
  await writeFile(
    idempotencyKeyringFile,
    `1:${randomBytes(32).toString("hex")}\n`,
    "utf8",
  );

  const auditKeyringFile = join(sessionKeyringDirectory, "audit.keyring");
  await writeFile(
    auditKeyringFile,
    `1:${randomBytes(32).toString("hex")}\n`,
    "utf8",
  );

  previousEnvironment = {
    NODE_ENV: process.env["NODE_ENV"],
    DATABASE_URL: process.env["DATABASE_URL"],
    SESSION_HASH_KEYRING_FILE: process.env["SESSION_HASH_KEYRING_FILE"],
    SESSION_HASH_KEYRING_TEST_PATH:
      process.env["SESSION_HASH_KEYRING_TEST_PATH"],
    SESSION_HASH_KEY_VERSION: process.env["SESSION_HASH_KEY_VERSION"],
    IDEMPOTENCY_FINGERPRINT_KEYRING_FILE:
      process.env["IDEMPOTENCY_FINGERPRINT_KEYRING_FILE"],
    IDEMPOTENCY_FINGERPRINT_KEYRING_TEST_PATH:
      process.env["IDEMPOTENCY_FINGERPRINT_KEYRING_TEST_PATH"],
    IDEMPOTENCY_FINGERPRINT_KEY_VERSION:
      process.env["IDEMPOTENCY_FINGERPRINT_KEY_VERSION"],
    AUDIT_HMAC_KEYRING_FILE: process.env["AUDIT_HMAC_KEYRING_FILE"],
    AUDIT_HMAC_KEYRING_TEST_PATH: process.env["AUDIT_HMAC_KEYRING_TEST_PATH"],
    AUDIT_HMAC_KEY_VERSION: process.env["AUDIT_HMAC_KEY_VERSION"],
  };
  process.env["NODE_ENV"] = "test";
  process.env["DATABASE_URL"] = urls.runtime;
  process.env["SESSION_HASH_KEYRING_FILE"] = sessionKeyringFile;
  process.env["SESSION_HASH_KEYRING_TEST_PATH"] = "1";
  process.env["SESSION_HASH_KEY_VERSION"] = String(HMAC_KEY_VERSION);
  process.env["IDEMPOTENCY_FINGERPRINT_KEYRING_FILE"] = idempotencyKeyringFile;
  process.env["IDEMPOTENCY_FINGERPRINT_KEYRING_TEST_PATH"] = "1";
  process.env["IDEMPOTENCY_FINGERPRINT_KEY_VERSION"] = String(HMAC_KEY_VERSION);
  process.env["AUDIT_HMAC_KEYRING_FILE"] = auditKeyringFile;
  process.env["AUDIT_HMAC_KEYRING_TEST_PATH"] = "1";
  process.env["AUDIT_HMAC_KEY_VERSION"] = String(HMAC_KEY_VERSION);

  userId = await createUser(runtime.sql);
  project = await createProject(runtime.sql, userId);

  const { AppModule } = await import("../src/app.module.js");
  app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api/v1");
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await app?.close();
  await runtime?.close();
  for (const [name, value] of Object.entries(previousEnvironment)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  if (sessionKeyringDirectory !== undefined) {
    await rm(sessionKeyringDirectory, { recursive: true, force: true });
  }
  if (idempotencyKeyringDirectory !== undefined) {
    await rm(idempotencyKeyringDirectory, { recursive: true, force: true });
  }
});

describe("业务审计请求上下文（真实 PostgreSQL 与真实 HTTP）", () => {
  test("业务写入的审计带上客户端 IP、User-Agent 与 X-Request-Id，且不替换内部 requestId", async () => {
    const cookie = await createSession();
    const csrf = await issueCsrf(cookie);
    const response = await createModule(cookie, csrf, {
      clientRequestId: CLIENT_REQUEST_ID,
      userAgent: FIXTURE_USER_AGENT,
    });
    expect(response.status).toBe(200);

    const row = await latestModuleCreateAudit();
    expect(row.clientRequestId).toBe(CLIENT_REQUEST_ID);
    expect(row.userAgent).toBe(FIXTURE_USER_AGENT);
    expect(row.ip).toBe("127.0.0.1");
    // 入站 X-Request-Id 只作留痕：内部 requestId 仍是服务端生成的 UUID。
    expect(row.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(row.requestId).not.toBe(CLIENT_REQUEST_ID);
  });

  test("未提供 X-Request-Id 时仍留 IP 与 User-Agent，客户端请求 ID 为 NULL", async () => {
    const cookie = await createSession();
    const csrf = await issueCsrf(cookie);
    const response = await createModule(cookie, csrf, {
      userAgent: FIXTURE_USER_AGENT,
    });
    expect(response.status).toBe(200);

    const row = await latestModuleCreateAudit();
    expect(row.clientRequestId).toBeNull();
    expect(row.userAgent).toBe(FIXTURE_USER_AGENT);
    expect(row.ip).toBe("127.0.0.1");
  });

  test("形状非法的 X-Request-Id 落 NULL 且不影响业务写入", async () => {
    const cookie = await createSession();
    const csrf = await issueCsrf(cookie);

    const withSpace = await createModule(cookie, csrf, {
      clientRequestId: "bad id with space",
      userAgent: FIXTURE_USER_AGENT,
    });
    expect(withSpace.status).toBe(200);
    expect((await latestModuleCreateAudit()).clientRequestId).toBeNull();

    const tooLong = await createModule(cookie, csrf, {
      clientRequestId: "a".repeat(65),
      userAgent: FIXTURE_USER_AGENT,
    });
    expect(tooLong.status).toBe(200);
    expect((await latestModuleCreateAudit()).clientRequestId).toBeNull();
  });

  test("超长 User-Agent 截断到 512 字符", async () => {
    const cookie = await createSession();
    const csrf = await issueCsrf(cookie);
    const response = await createModule(cookie, csrf, {
      userAgent: "u".repeat(600),
    });
    expect(response.status).toBe(200);

    const row = await latestModuleCreateAudit();
    expect(row.userAgent).toHaveLength(512);
    expect(row.userAgent).toBe("u".repeat(512));
  });
});
