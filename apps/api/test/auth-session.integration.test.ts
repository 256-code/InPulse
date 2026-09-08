import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  createDatabaseClient,
  type DatabaseClient,
} from "@inpulse/database/client";
import { PostgresSessionCsrfTokenRepository } from "../src/auth/session-csrf-token.repository.js";
import { PostgresUserSessionRepository } from "../src/auth/user-session.repository.js";
import { PostgresUnitOfWork } from "../src/database/unit-of-work.js";
import { createUser, testUrls } from "./database.helpers.js";

let client: DatabaseClient | undefined;
let unitOfWork: PostgresUnitOfWork;
let userId: number;
let sessionId: number;
let sessionTokenHash: Buffer;

beforeAll(async () => {
  client = createDatabaseClient(testUrls().runtime, {
    applicationName: "inpulse-auth-session-test",
  });
  unitOfWork = new PostgresUnitOfWork(client);
  userId = await createUser(client.sql);
  sessionTokenHash = randomBytes(32);
  const rows = (await client.sql`
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
      ${sessionTokenHash},
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
    RETURNING id
  `) as unknown as readonly { id: number }[];
  if (rows.length !== 1) {
    throw new Error("user session fixture insert returned no row");
  }
  sessionId = rows[0]!.id;
});

afterAll(async () => {
  await client?.close();
});

describe("认证 Session CSRF 存取（真实 PostgreSQL）", () => {
  test("有效 Session 可在事务中按 Token 哈希查回", async () => {
    const repository = new PostgresUserSessionRepository();
    const session = await unitOfWork.run((tx) =>
      repository.findValidByTokenHashes(tx, [sessionTokenHash]),
    );
    expect(session?.id).toBe(sessionId);
    expect(session?.userId).toBe(userId);
    expect(session?.authState).toBe("AUTHENTICATED");
    expect(session?.idleExpiresAt).toBeInstanceOf(Date);
    expect(session?.absoluteExpiresAt).toBeInstanceOf(Date);
  });

  test("Session 行锁内重复签发最多保留 4 个有效 CSRF Hash", async () => {
    const repository = new PostgresSessionCsrfTokenRepository();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    for (let index = 0; index < 5; index += 1) {
      await unitOfWork.run((tx) =>
        repository.issue(tx, {
          sessionId,
          tokenHash: randomBytes(32),
          expiresAt,
        }),
      );
    }

    const counts = (await client!.sql`
      SELECT count(*)::int AS count
        FROM app.session_csrf_tokens
       WHERE session_id = ${sessionId}
    `) as unknown as readonly { count: number }[];
    expect(counts[0]?.count).toBe(4);
  });
});
