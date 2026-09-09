import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  createDatabaseClient,
  type DatabaseClient,
} from "@inpulse/database/client";
import { PostgresSessionCleanupRepository } from "../src/auth/session-cleanup.repository.js";
import { PostgresUnitOfWork } from "../src/database/unit-of-work.js";
import { createUser, testUrls } from "./database.helpers.js";

let client: DatabaseClient | undefined;
let unitOfWork: PostgresUnitOfWork;
let repository: PostgresSessionCleanupRepository;
let userId: number;
let activeSessionId: number | undefined;
let activePreauthId: number | undefined;
let expiredSessionIds: readonly number[] = [];
let expiredCsrfHashes: readonly Buffer[] = [];
let expiredPreauthIds: readonly number[] = [];

async function insertUserSession(options: {
  readonly createdAt: string;
  readonly lastSeenAt: string;
  readonly idleExpiresAt: string;
  readonly absoluteExpiresAt: string;
  readonly revokedAt: string | null;
}): Promise<number> {
  const [row] = (await client!.sql`
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
      absolute_expires_at,
      revoked_at
    )
    VALUES (
      ${userId},
      ${randomBytes(32)},
      1,
      1,
      'AUTHENTICATED',
      0,
      0,
      ${options.createdAt}::timestamptz,
      ${options.lastSeenAt}::timestamptz,
      ${options.idleExpiresAt}::timestamptz,
      ${options.absoluteExpiresAt}::timestamptz,
      ${options.revokedAt}
    )
    RETURNING id
  `) as unknown as readonly { id: number }[];
  if (row === undefined) {
    throw new Error("session fixture insert returned no row");
  }
  return row.id;
}

async function insertCsrf(
  sessionId: number,
  options: { readonly issuedAt: string; readonly expiresAt: string },
): Promise<Buffer> {
  const tokenHash = randomBytes(32);
  const [row] = (await client!.sql`
    INSERT INTO app.session_csrf_tokens (
      session_id,
      token_hash,
      issued_at,
      expires_at
    )
    VALUES (
      ${sessionId},
      ${tokenHash},
      ${options.issuedAt}::timestamptz,
      ${options.expiresAt}::timestamptz
    )
    RETURNING token_hash
  `) as unknown as readonly { token_hash: Buffer }[];
  if (row === undefined) {
    throw new Error("csrf fixture insert returned no row");
  }
  return row.token_hash;
}

async function insertPreauth(options: {
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly consumedAt: string | null;
}): Promise<number> {
  const [row] = (await client!.sql`
    INSERT INTO app.preauth_sessions (
      token_hash,
      token_hash_key_version,
      csrf_token_hash,
      created_at,
      expires_at,
      consumed_at
    )
    VALUES (
      ${randomBytes(32)},
      1,
      ${randomBytes(32)},
      ${options.createdAt}::timestamptz,
      ${options.expiresAt}::timestamptz,
      ${options.consumedAt}
    )
    RETURNING id
  `) as unknown as readonly { id: number }[];
  if (row === undefined) {
    throw new Error("preauth fixture insert returned no row");
  }
  return row.id;
}

beforeAll(async () => {
  client = createDatabaseClient(testUrls().runtime, {
    applicationName: "inpulse-session-cleanup-test",
  });
  unitOfWork = new PostgresUnitOfWork(client);
  repository = new PostgresSessionCleanupRepository();
  await unitOfWork.run((tx) => repository.cleanupBatch(tx, 100_000));
  userId = await createUser(client.sql);

  expiredSessionIds = [
    await insertUserSession({
      createdAt: new Date(Date.now() - 32 * 24 * 60 * 60 * 1000).toISOString(),
      lastSeenAt: new Date(Date.now() - 32 * 24 * 60 * 60 * 1000).toISOString(),
      idleExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      absoluteExpiresAt: new Date(
        Date.now() + 24 * 60 * 60 * 1000,
      ).toISOString(),
      revokedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(),
    }),
    await insertUserSession({
      createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      lastSeenAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      idleExpiresAt: new Date(
        Date.now() - 9 * 24 * 60 * 60 * 1000,
      ).toISOString(),
      absoluteExpiresAt: new Date(
        Date.now() - 8 * 24 * 60 * 60 * 1000,
      ).toISOString(),
      revokedAt: null,
    }),
  ];

  const activeRow = await insertUserSession({
    createdAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    idleExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    absoluteExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    revokedAt: null,
  });
  activeSessionId = activeRow;

  expiredCsrfHashes = [
    await insertCsrf(activeRow, {
      issuedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      expiresAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    }),
  ];
  await insertCsrf(activeRow, {
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });

  expiredPreauthIds = [
    await insertPreauth({
      createdAt: new Date(Date.now() - 9 * 60 * 1000).toISOString(),
      expiresAt: new Date(Date.now() - 60 * 1000).toISOString(),
      consumedAt: null,
    }),
    await insertPreauth({
      createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      expiresAt: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
      consumedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    }),
  ];
  const activePreauthRow = await insertPreauth({
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 9 * 60 * 1000).toISOString(),
    consumedAt: null,
  });
  activePreauthId = activePreauthRow;
});

afterAll(async () => {
  await client?.close();
});

describe("Session 分批清理（真实 PostgreSQL）", () => {
  test("只删除过期 Session/CSRF/预认证 Session，保留活跃数据", async () => {
    const result = await unitOfWork.run((tx) =>
      repository.cleanupBatch(tx, 100),
    );

    expect(result).toEqual({
      deletedUserSessions: 2,
      deletedSessionCsrfTokens: 1,
      deletedPreauthSessions: 2,
    });
    for (const id of expiredSessionIds) {
      const rows = (await client!.sql`
        SELECT id FROM app.user_sessions WHERE id = ${id}
      `) as unknown as readonly { id: number }[];
      expect(rows).toHaveLength(0);
    }
    for (const hash of expiredCsrfHashes) {
      const rows = (await client!.sql`
        SELECT token_hash FROM app.session_csrf_tokens
         WHERE token_hash = ${hash}
      `) as unknown as readonly { token_hash: Buffer }[];
      expect(rows).toHaveLength(0);
    }
    for (const id of expiredPreauthIds) {
      const rows = (await client!.sql`
        SELECT id FROM app.preauth_sessions WHERE id = ${id}
      `) as unknown as readonly { id: number }[];
      expect(rows).toHaveLength(0);
    }
  });

  test("活跃 Session 与预认证 Session 未被清理", async () => {
    if (activeSessionId === undefined || activePreauthId === undefined) {
      throw new Error("active fixture was not created");
    }
    const rows = (await client!.sql`
      SELECT id
        FROM app.user_sessions
       WHERE id = ${activeSessionId}
    `) as unknown as readonly { id: number }[];
    const preauthRows = (await client!.sql`
      SELECT id
        FROM app.preauth_sessions
       WHERE id = ${activePreauthId}
    `) as unknown as readonly { id: number }[];
    expect(rows).toHaveLength(1);
    expect(preauthRows).toHaveLength(1);
  });
});
