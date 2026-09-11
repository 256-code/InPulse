/**
 * SEC-003 / ADR-015 CSRF 完整生命周期（真实 PostgreSQL 与真实 HTTP）。
 * 首登、轮换、刷新、多标签由浏览器 E2E（apps/e2e/tests/csrf.spec.ts）覆盖；
 * 本文件覆盖材料失效与恢复的服务端语义：
 * - 预认证 CSRF 失败不消费材料，重签后重试一次成功，成功即单次消费且不可二次使用；
 * - 认证 Session 最多保留 4 个 CSRF 并淘汰最旧，过期后重签恢复写操作；
 * - 预认证材料过期后登录被拒，重签恢复；
 * - securityFlow（login）不参与业务幂等；普通幂等路由缺失 Idempotency-Key 返回 400。
 */
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { hash } from "@node-rs/argon2";
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
  createProject,
  testUrls,
  type ProjectFixture,
} from "./database.helpers.js";

const HMAC_KEY_VERSION = 1;
const SESSION_COOKIE_NAME = "__Host-session";
const PREAUTH_COOKIE_NAME = "__Host-preauth";
const FIXTURE_PASSWORD = "csrf-lifecycle-password";

let app: INestApplication | undefined;
let baseUrl: string;
let runtime: DatabaseClient | undefined;
let sessionKey: Buffer;
let sessionKeyringDirectory: string | undefined;
let idempotencyKeyringDirectory: string | undefined;
let previousEnvironment: Readonly<Record<string, string | undefined>> = {};
let loginUser: { readonly id: number; readonly loginName: string };
let project: ProjectFixture;

interface ErrorBody {
  readonly code: string;
}

interface CsrfBody {
  readonly csrfToken: string;
}

interface LoginBody {
  readonly csrfToken: string;
  readonly authState: string;
}

interface HttpResponse {
  readonly status: number;
  readonly body: unknown;
  readonly setCookies: readonly string[];
}

function setCookieValue(
  setCookies: readonly string[],
  name: string,
): string | undefined {
  for (const header of setCookies) {
    const pair = header.split(";", 1)[0];
    const separator = pair?.indexOf("=") ?? -1;
    if (pair === undefined || separator <= 0) {
      continue;
    }
    if (pair.slice(0, separator) === name) {
      return pair.slice(separator + 1);
    }
  }
  return undefined;
}

async function http(
  path: string,
  options: {
    readonly method?: string;
    readonly cookie?: string;
    readonly csrf?: string;
    readonly idempotencyKey?: string;
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

async function issueCsrf(cookie?: string): Promise<{
  readonly csrfToken: string;
  readonly preauthToken: string | undefined;
}> {
  const response = await http("/auth/csrf", {
    ...(cookie === undefined ? {} : { cookie }),
  });
  expect(response.status).toBe(200);
  const body = response.body as CsrfBody;
  return {
    csrfToken: body.csrfToken,
    preauthToken: setCookieValue(response.setCookies, PREAUTH_COOKIE_NAME),
  };
}

async function login(
  preauthToken: string,
  csrfToken: string | undefined,
  options: {
    readonly idempotencyKey?: string;
    readonly sessionCookie?: string;
  } = {},
): Promise<{
  readonly status: number;
  readonly body: Partial<LoginBody> & Partial<ErrorBody>;
  readonly sessionToken: string | undefined;
}> {
  const cookieHeader =
    options.sessionCookie === undefined
      ? `${PREAUTH_COOKIE_NAME}=${preauthToken}`
      : `${options.sessionCookie}; ${PREAUTH_COOKIE_NAME}=${preauthToken}`;
  const response = await http("/auth/login", {
    method: "POST",
    cookie: cookieHeader,
    ...(csrfToken === undefined ? {} : { csrf: csrfToken }),
    ...(options.idempotencyKey === undefined
      ? {}
      : { idempotencyKey: options.idempotencyKey }),
    body: { loginName: loginUser.loginName, password: FIXTURE_PASSWORD },
  });
  return {
    status: response.status,
    body: response.body as Partial<LoginBody> & Partial<ErrorBody>,
    sessionToken: setCookieValue(response.setCookies, SESSION_COOKIE_NAME),
  };
}

async function logout(cookie: string, csrf: string): Promise<number> {
  const response = await http("/auth/logout", {
    method: "POST",
    cookie,
    csrf,
  });
  return response.status;
}

async function createSession(): Promise<{
  readonly sessionId: number;
  readonly cookie: string;
}> {
  const rows = (await runtime!.sql`
    SELECT auth_version AS "authVersion"
      FROM app.users
     WHERE id = ${loginUser.id}
  `) as unknown as readonly { authVersion: number }[];
  const authVersion = rows[0]?.authVersion ?? 1;
  const token = generateOpaqueToken();
  const created = (await runtime!.sql`
    INSERT INTO app.user_sessions (
      user_id, token_hash, token_hash_key_version, auth_version_at_issue,
      auth_state, recovery_rotation_generation,
      recovery_rotation_consumed_generation, idle_expires_at,
      absolute_expires_at
    )
    VALUES (
      ${loginUser.id}, ${hashOpaqueToken(token, sessionKey)},
      ${HMAC_KEY_VERSION}, ${authVersion}, ${"AUTHENTICATED"}, 0, 0,
      now() + ${"1 hour"}::interval, now() + ${"1 day"}::interval
    )
    RETURNING id
  `) as unknown as readonly { id: number }[];
  return {
    sessionId: created[0]!.id,
    cookie: `${SESSION_COOKIE_NAME}=${token}`,
  };
}

async function createModule(
  sessionCookie: string,
  csrfToken: string,
  options: { readonly idempotencyKey?: string | null } = {},
): Promise<HttpResponse> {
  return http(`/projects/${project.projectId}/modules`, {
    method: "POST",
    cookie: sessionCookie,
    csrf: csrfToken,
    ...(options.idempotencyKey === null
      ? {}
      : { idempotencyKey: options.idempotencyKey ?? randomUUID() }),
    body: { name: `CSRF 模块 ${randomUUID().slice(0, 8)}` },
  });
}

async function createLoginUser(): Promise<{
  readonly id: number;
  readonly loginName: string;
}> {
  const loginName = `csrf_${randomUUID().replaceAll("-", "")}`.slice(0, 80);
  const passwordHash = await hash(FIXTURE_PASSWORD, {
    memoryCost: 19 * 1024,
    timeCost: 2,
    parallelism: 1,
    outputLen: 32,
    algorithm: 2,
  });
  const rows = (await runtime!.sql`
    INSERT INTO app.users (login_name, name, password_hash, is_admin, status)
    VALUES (${loginName}, ${`CSRF ${loginName}`}, ${passwordHash}, false, ${"ACTIVE"})
    RETURNING id
  `) as unknown as readonly { id: number }[];
  return { id: rows[0]!.id, loginName };
}

beforeAll(async () => {
  const urls = testUrls();
  runtime = createDatabaseClient(urls.runtime, {
    applicationName: "inpulse-csrf-lifecycle-api-test",
  });
  await migrate(urls.migrator);

  sessionKey = randomBytes(32);
  sessionKeyringDirectory = await mkdtemp(
    join(tmpdir(), "inpulse-csrf-session-"),
  );
  const sessionKeyringFile = join(sessionKeyringDirectory, "session.keyring");
  await writeFile(
    sessionKeyringFile,
    `1:${sessionKey.toString("hex")}\n`,
    "utf8",
  );
  const totpKekFile = join(sessionKeyringDirectory, "totp.kek.keyring");
  await writeFile(
    totpKekFile,
    `1:${randomBytes(32).toString("hex")}\n`,
    "utf8",
  );

  idempotencyKeyringDirectory = await mkdtemp(
    join(tmpdir(), "inpulse-csrf-idempotency-"),
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
    TOTP_KEK_VERSION: process.env["TOTP_KEK_VERSION"],
    TOTP_KEK_KEYRING_FILE: process.env["TOTP_KEK_KEYRING_FILE"],
    TOTP_KEK_KEYRING_TEST_PATH: process.env["TOTP_KEK_KEYRING_TEST_PATH"],
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
  process.env["TOTP_KEK_VERSION"] = String(HMAC_KEY_VERSION);
  process.env["TOTP_KEK_KEYRING_FILE"] = totpKekFile;
  process.env["TOTP_KEK_KEYRING_TEST_PATH"] = "1";
  process.env["AUDIT_HMAC_KEYRING_FILE"] = auditKeyringFile;
  process.env["AUDIT_HMAC_KEYRING_TEST_PATH"] = "1";
  process.env["AUDIT_HMAC_KEY_VERSION"] = String(HMAC_KEY_VERSION);

  loginUser = await createLoginUser();
  project = await createProject(runtime.sql, loginUser.id);

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

describe("SEC-003 CSRF 生命周期（真实 PostgreSQL 与真实 HTTP）", () => {
  test("预认证 CSRF 失败不消费材料，重签后重试一次成功且材料单次消费", async () => {
    const first = await issueCsrf();
    expect(first.preauthToken).toBeDefined();

    const rejected = await login(first.preauthToken!, "z".repeat(43));
    expect(rejected.status).toBe(401);
    expect(rejected.body.code).toBe("INVALID_AUTH_CREDENTIALS");

    const reissued = await issueCsrf(
      `${PREAUTH_COOKIE_NAME}=${first.preauthToken!}`,
    );
    expect(reissued.preauthToken).toBeDefined();
    expect(reissued.preauthToken).not.toBe(first.preauthToken);

    const accepted = await login(reissued.preauthToken!, reissued.csrfToken);
    expect(accepted.status).toBe(200);
    expect(accepted.body.authState).toBe("AUTHENTICATED");
    expect(accepted.sessionToken).toBeDefined();

    const conflict = await login(reissued.preauthToken!, reissued.csrfToken, {
      sessionCookie: `${SESSION_COOKIE_NAME}=${accepted.sessionToken!}`,
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe("AUTH_SESSION_CONFLICT");

    expect(
      await logout(
        `${SESSION_COOKIE_NAME}=${accepted.sessionToken!}`,
        accepted.body.csrfToken!,
      ),
    ).toBe(204);

    const consumed = await login(reissued.preauthToken!, reissued.csrfToken);
    expect(consumed.status).toBe(401);
    expect(consumed.body.code).toBe("INVALID_AUTH_CREDENTIALS");

    const stillUsable = await login(first.preauthToken!, first.csrfToken);
    expect(stillUsable.status).toBe(200);
    await logout(
      `${SESSION_COOKIE_NAME}=${stillUsable.sessionToken!}`,
      stillUsable.body.csrfToken!,
    );
  });

  test("认证 Session 最多保留 4 个 CSRF，淘汰最旧，过期后重签恢复写操作", async () => {
    const session = await createSession();
    const tokens: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      tokens.push((await issueCsrf(session.cookie)).csrfToken);
    }
    expect(new Set(tokens).size).toBe(5);

    const counts = (await runtime!.sql`
      SELECT count(*)::int AS count
        FROM app.session_csrf_tokens
       WHERE session_id = ${session.sessionId}
         AND expires_at > now()
    `) as unknown as readonly { count: number }[];
    expect(counts[0]?.count).toBe(4);

    const evicted = await createModule(session.cookie, tokens[0]!);
    expect(evicted.status).toBe(401);
    expect((evicted.body as ErrorBody).code).toBe("MODULE_SESSION_REQUIRED");

    const surviving = await createModule(session.cookie, tokens[1]!);
    expect(surviving.status).toBe(200);
    const newest = await createModule(session.cookie, tokens[4]!);
    expect(newest.status).toBe(200);

    await runtime!.sql`
      UPDATE app.session_csrf_tokens
         SET issued_at = now() - ${"2 hours"}::interval,
             expires_at = now() - ${"1 hour"}::interval
       WHERE session_id = ${session.sessionId}
    `;
    const expired = await createModule(session.cookie, tokens[4]!);
    expect(expired.status).toBe(401);

    const reissued = await issueCsrf(session.cookie);
    const recovered = await createModule(session.cookie, reissued.csrfToken);
    expect(recovered.status).toBe(200);
  });

  test("预认证材料过期后登录被拒，重签后成功", async () => {
    const issued = await issueCsrf();
    await runtime!.sql`
      UPDATE app.preauth_sessions
         SET created_at = now() - ${"20 minutes"}::interval,
             expires_at = now() - ${"10 minutes"}::interval
       WHERE token_hash = ${hashOpaqueToken(issued.preauthToken!, sessionKey)}
    `;
    const rejected = await login(issued.preauthToken!, issued.csrfToken);
    expect(rejected.status).toBe(401);
    expect(rejected.body.code).toBe("INVALID_AUTH_CREDENTIALS");

    const reissued = await issueCsrf(
      `${PREAUTH_COOKIE_NAME}=${issued.preauthToken!}`,
    );
    const accepted = await login(reissued.preauthToken!, reissued.csrfToken);
    expect(accepted.status).toBe(200);
    await logout(
      `${SESSION_COOKIE_NAME}=${accepted.sessionToken!}`,
      accepted.body.csrfToken!,
    );
  });

  test("securityFlow 不参与业务幂等，普通幂等路由缺失 Idempotency-Key 返回 400", async () => {
    const issued = await issueCsrf();
    const accepted = await login(issued.preauthToken!, issued.csrfToken, {
      idempotencyKey: randomUUID(),
    });
    expect(accepted.status).toBe(200);
    const sessionCookie = `${SESSION_COOKIE_NAME}=${accepted.sessionToken!}`;

    const stored = (await runtime!.sql`
      SELECT count(*)::int AS count
        FROM app.idempotency_records
       WHERE operation_id = ${"login"}
    `) as unknown as readonly { count: number }[];
    expect(stored[0]?.count).toBe(0);

    const missing = await createModule(
      sessionCookie,
      accepted.body.csrfToken!,
      {
        idempotencyKey: null,
      },
    );
    expect(missing.status).toBe(400);
    expect((missing.body as ErrorBody).code).toBe("IDEMPOTENCY_KEY_REQUIRED");

    const created = await createModule(sessionCookie, accepted.body.csrfToken!);
    expect(created.status).toBe(200);

    await logout(sessionCookie, accepted.body.csrfToken!);
  });
});
