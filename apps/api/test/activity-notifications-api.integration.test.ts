import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Sql } from "postgres";

import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { DatabaseClient } from "@inpulse/database/client";
import { createDatabaseClient } from "@inpulse/database/client";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { migrate } from "../../../database/src/migrate.ts";
import {
  activityPageSchema,
  notificationPageSchema,
  notificationUnreadCountResponseSchema,
} from "../../../packages/api-contract/src/index.ts";
import { VersionedHmacKeyring } from "../src/auth/keyring.js";
import { generateOpaqueToken, hashOpaqueToken } from "../src/auth/token.js";
import { PostgresAuditWritePort } from "../src/audit/postgres-audit-write-port.js";
import { PostgresUnitOfWork } from "../src/database/unit-of-work.js";
import { PostgresActivityWritePort } from "../src/modules/activity/postgres-activity-write-port.js";
import { PostgresNotificationWritePort } from "../src/modules/notifications/postgres-notification-write-port.js";
import {
  testUrls,
  createUser,
  createProject,
  type ProjectFixture,
} from "./database.helpers.js";

const SESSION_COOKIE_NAME = "__Host-session";
const HMAC_KEY_VERSION = 1;
const auditKey = Buffer.alloc(32, 0x51);

interface ErrorResponseDto {
  readonly code: string;
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly requestId: string;
}

interface ActivityPageDto {
  readonly items: readonly {
    readonly projectId: number;
    readonly sourceEntityType: string;
    readonly sourceEntityId: number;
    readonly activityType: string;
    readonly summary: string;
  }[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

interface NotificationPageDto {
  readonly items: readonly { readonly id: string }[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

interface UnreadCountDto {
  readonly unreadCount: number;
}

let app: INestApplication | undefined;
let baseUrl: string;
let runtime: DatabaseClient | undefined;
let uow: PostgresUnitOfWork | undefined;
let activityPort: PostgresActivityWritePort | undefined;
let notificationPort: PostgresNotificationWritePort | undefined;
let auditPort: PostgresAuditWritePort | undefined;
let member: ProjectFixture | undefined;
let other: ProjectFixture | undefined;
let memberCookie: string;
let adminCookie: string;
let memberNotificationId: number;
let otherNotificationId: number;
let sessionKeyringDirectory: string | undefined;
let idempotencyKeyringDirectory: string | undefined;
let previousEnvironment: Readonly<Record<string, string | undefined>> = {};

beforeAll(async () => {
  const urls = testUrls();
  runtime = createDatabaseClient(urls.runtime, {
    applicationName: "inpulse-activity-notifications-api-test",
  });
  await migrate(urls.migrator);
  uow = new PostgresUnitOfWork(runtime);
  auditPort = new PostgresAuditWritePort({
    currentVersion: 1,
    keyFor: () => auditKey,
  });
  activityPort = new PostgresActivityWritePort();
  notificationPort = new PostgresNotificationWritePort();

  const memberUser = await createUser(runtime.sql);
  const otherUser = await createUser(runtime.sql);
  const adminUser = await createUser(runtime.sql, { admin: true });
  member = await createProject(runtime.sql, memberUser);
  other = await createProject(runtime.sql, otherUser);
  await createProject(runtime.sql, adminUser);

  await seedActivity(
    member,
    memberUser,
    101,
    "TASK_COMPLETED",
    "成员项目动态",
    "MEMBER",
    "DONE",
    1,
    "2026-09-08T00:00:01.000Z",
  );
  await seedActivity(
    member,
    memberUser,
    102,
    "CHANGE_RECORD_VOIDED",
    "管理员作废记录",
    "ADMIN_ONLY",
    "VOID",
    2,
    "2026-09-08T00:00:02.000Z",
  );
  await seedActivity(
    other,
    otherUser,
    201,
    "PROJECT_CREATED",
    "其他项目动态",
    "MEMBER",
    "ACTIVE",
    1,
    "2026-09-08T00:00:03.000Z",
  );

  const memberNotification = await seedNotification(
    member,
    memberUser,
    "PROJECT_JOINED",
    "你已加入成员项目",
    `/projects/${member.projectId}/activity`,
    "2026-09-08T00:00:04.000Z",
  );
  const otherNotification = await seedNotification(
    other,
    otherUser,
    "PROJECT_JOINED",
    "其他项目通知",
    `/projects/${other.projectId}/activity`,
    "2026-09-08T00:00:05.000Z",
  );
  memberNotificationId = memberNotification;
  otherNotificationId = otherNotification;

  const sessionKey = randomBytes(32);
  const sessionKeyring = VersionedHmacKeyring.fromEntries(
    [{ version: 1, key: sessionKey }],
    1,
  );
  sessionKeyringDirectory = await mkdtemp(
    join(tmpdir(), "inpulse-session-api-"),
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
  const sessionMaterial = await createAuthenticatedSession(
    runtime.sql,
    sessionKeyring,
    memberUser,
  );
  memberCookie = sessionMaterial.cookie;
  adminCookie = (
    await createAuthenticatedSession(runtime.sql, sessionKeyring, adminUser)
  ).cookie;

  idempotencyKeyringDirectory = await mkdtemp(
    join(tmpdir(), "inpulse-idempotency-api-"),
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

  previousEnvironment = {
    DATABASE_URL: process.env["DATABASE_URL"],
    NODE_ENV: process.env["NODE_ENV"],
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

describe("GET /api/v1/projects/{projectId}/activity and /notifications with real HTTP", () => {
  test("匿名请求返回统一 401，有效成员只返回本人项目动态", async () => {
    const anon = await requestActivity(baseUrl, member!.projectId, undefined);
    expect(anon.status).toBe(401);
    expect(((await anon.json()) as ErrorResponseDto).code).toBe(
      "ACTIVITY_UNAUTHENTICATED",
    );

    const response = await requestActivity(
      baseUrl,
      member!.projectId,
      memberCookie,
    );
    expect(response.status).toBe(200);
    const page = (await response.json()) as ActivityPageDto;
    expect(activityPageSchema.safeParse(page).success).toBe(true);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.summary).toBe("成员项目动态");
  });

  test("管理员可显式查看 ADMIN_ONLY，普通成员不能通过参数越权", async () => {
    const memberResponse = await requestActivity(
      baseUrl,
      member!.projectId,
      memberCookie,
      { includeAdminOnly: "true" },
    );
    expect(
      ((await memberResponse.json()) as { items: unknown[] }).items,
    ).toHaveLength(1);

    const adminResponse = await requestActivity(
      baseUrl,
      member!.projectId,
      adminCookie,
      { includeAdminOnly: "true" },
    );
    const page = (await adminResponse.json()) as ActivityPageDto;
    expect(activityPageSchema.safeParse(page).success).toBe(true);
    expect(page.items).toHaveLength(2);
  });

  test("通知查询只返回当前用户，未读数和标记接口都只操作本人", async () => {
    const listResponse = await requestNotifications(baseUrl, memberCookie);
    expect(listResponse.status).toBe(200);
    const list = (await listResponse.json()) as NotificationPageDto;
    expect(notificationPageSchema.safeParse(list).success).toBe(true);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]!.id).toBe(String(memberNotificationId));

    const countResponse = await requestUnreadCount(baseUrl, memberCookie);
    expect(countResponse.status).toBe(200);
    const count = (await countResponse.json()) as UnreadCountDto;
    expect(notificationUnreadCountResponseSchema.safeParse(count).success).toBe(
      true,
    );
    expect(count.unreadCount).toBe(1);

    const csrf = await issueCsrf(baseUrl, memberCookie);
    const mutationResponse = await postNotification(
      baseUrl,
      memberCookie,
      `/notifications/${memberNotificationId}/read`,
      csrf,
      randomBytes(16).toString("hex"),
    );
    expect(mutationResponse.status).toBe(204);
    expect(await mutationResponse.text()).toBe("");

    const afterRead = await requestUnreadCount(baseUrl, memberCookie);
    expect(((await afterRead.json()) as UnreadCountDto).unreadCount).toBe(0);
  });

  test("幂等重放、缺失 Key、越权与 read-all 行为符合契约", async () => {
    const csrf = await issueCsrf(baseUrl, memberCookie);
    const key = randomBytes(16).toString("hex");
    const first = await postNotification(
      baseUrl,
      memberCookie,
      `/notifications/${memberNotificationId}/unread`,
      csrf,
      key,
    );
    expect(first.status).toBe(204);
    const replay = await postNotification(
      baseUrl,
      memberCookie,
      `/notifications/${memberNotificationId}/unread`,
      csrf,
      key,
    );
    expect(replay.status).toBe(204);

    const missingKey = await postNotification(
      baseUrl,
      memberCookie,
      `/notifications/${memberNotificationId}/read`,
      csrf,
      undefined,
    );
    expect(missingKey.status).toBe(400);
    expect(((await missingKey.json()) as ErrorResponseDto).code).toBe(
      "IDEMPOTENCY_KEY_REQUIRED",
    );

    const crossUser = await postNotification(
      baseUrl,
      memberCookie,
      `/notifications/${otherNotificationId}/read`,
      csrf,
      randomBytes(16).toString("hex"),
    );
    expect(crossUser.status).toBe(404);
    expect(((await crossUser.json()) as ErrorResponseDto).code).toBe(
      "NOTIFICATION_NOT_FOUND",
    );

    const readAllKey = randomBytes(16).toString("hex");
    const readAll = await postNotification(
      baseUrl,
      memberCookie,
      "/notifications/read-all",
      csrf,
      readAllKey,
    );
    expect(readAll.status).toBe(204);
    const count = await requestUnreadCount(baseUrl, memberCookie);
    expect(((await count.json()) as UnreadCountDto).unreadCount).toBe(0);
  });
});

async function createAuthenticatedSession(
  sql: Sql,
  keyring: VersionedHmacKeyring,
  userId: number,
): Promise<{ readonly cookie: string }> {
  const rows = (await sql`
    SELECT auth_version AS "authVersion"
      FROM app.users
     WHERE id = ${userId}
  `) as unknown as readonly { authVersion: number }[];
  const user = rows[0];
  if (user === undefined) {
    throw new Error("user fixture missing");
  }
  const token = generateOpaqueToken();
  await sql`
    INSERT INTO app.user_sessions (
      user_id, token_hash, token_hash_key_version, auth_version_at_issue,
      auth_state, recovery_rotation_generation, recovery_rotation_consumed_generation,
      created_at, last_seen_at, idle_expires_at, absolute_expires_at
    )
    VALUES (
      ${userId}, ${hashOpaqueToken(token, keyring.currentKey())}, ${HMAC_KEY_VERSION},
      ${user.authVersion}, 'AUTHENTICATED', 0, 0, now(), now(),
      now() + interval '1 hour', now() + interval '1 day'
    )
  `;
  return { cookie: `${SESSION_COOKIE_NAME}=${token}` };
}

async function seedActivity(
  project: ProjectFixture,
  actorId: number,
  entityId: number,
  action: string,
  summary: string,
  scope: "MEMBER" | "ADMIN_ONLY",
  status: string,
  rowVersion: number,
  occurredAt: string,
): Promise<void> {
  await uow!.run(async (tx) => {
    const audit = await auditPort!.append(tx, {
      projectId: project.projectId,
      actorType: "USER",
      actorId,
      action,
      targetType: "TASK",
      targetId: String(entityId),
      eventPayload: { summary },
      requestId: randomBytes(16).toString("hex"),
      clientRequestId: null,
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
      occurredAt: new Date(occurredAt),
    });
    await activityPort!.append(tx, {
      projectId: project.projectId,
      sourceChainId: `PROJECT:${project.projectId}`,
      sourceSequence: audit.sequenceNo,
      sourceEntityType: "TASK",
      sourceEntityId: entityId,
      activityType: action,
      actorId,
      summary,
      metadata: {},
      visibilityScope: scope,
      sourceStatus: status,
      sourceRowVersion: rowVersion,
      occurredAt: new Date(occurredAt),
    });
  });
}

async function seedNotification(
  project: ProjectFixture,
  recipientId: number,
  type: string,
  title: string,
  targetPath: string,
  createdAt: string,
): Promise<number> {
  return uow!.run(async (tx) => {
    const audit = await auditPort!.append(tx, {
      projectId: project.projectId,
      actorType: "USER",
      actorId: recipientId,
      action: type,
      targetType: "PROJECT",
      targetId: String(project.projectId),
      eventPayload: { title },
      requestId: randomBytes(16).toString("hex"),
      clientRequestId: null,
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
      occurredAt: new Date(createdAt),
    });
    await notificationPort!.write(tx, {
      recipientId,
      projectId: project.projectId,
      sourceChainId: `PROJECT:${project.projectId}`,
      sourceSequence: audit.sequenceNo,
      notificationType: type,
      title,
      body: "测试站内通知",
      targetPath,
      createdAt: new Date(createdAt),
    });
    const rows = (await tx.sql`
      SELECT id::bigint AS id
        FROM app.notifications
       WHERE recipient_id = ${recipientId}
         AND source_sequence = ${audit.sequenceNo}
         AND notification_type = ${type}
    `) as unknown as readonly { id: string }[];
    return Number(rows[0]!.id);
  });
}

async function requestActivity(
  url: string,
  projectId: number,
  cookie: string | undefined,
  query: Readonly<Record<string, string>> = {},
): Promise<Response> {
  const target = new URL(`${url}/api/v1/projects/${projectId}/activity`);
  for (const [name, value] of Object.entries(query)) {
    target.searchParams.set(name, value);
  }
  return fetch(
    target,
    cookie === undefined ? undefined : { headers: { cookie } },
  );
}

async function requestNotifications(
  url: string,
  cookie: string,
): Promise<Response> {
  return fetch(`${url}/api/v1/notifications`, { headers: { cookie } });
}

async function requestUnreadCount(
  url: string,
  cookie: string,
): Promise<Response> {
  return fetch(`${url}/api/v1/notifications/unread-count`, {
    headers: { cookie },
  });
}

async function issueCsrf(url: string, cookie: string): Promise<string> {
  const response = await fetch(`${url}/api/v1/auth/csrf`, {
    headers: { cookie },
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { readonly csrfToken: string };
  return body.csrfToken;
}

async function postNotification(
  url: string,
  cookie: string,
  path: string,
  csrf: string,
  key: string | undefined,
): Promise<Response> {
  const headers: Record<string, string> = {
    cookie,
    host: new URL(url).host,
    origin: new URL(url).origin,
    "x-csrf-token": csrf,
  };
  if (key !== undefined) {
    headers["idempotency-key"] = key;
  }
  return fetch(`${url}/api/v1${path}`, { method: "POST", headers });
}
