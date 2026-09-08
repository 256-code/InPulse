import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  createDatabaseClient,
  type DatabaseClient,
} from "@inpulse/database/client";
import { LogoutService } from "../src/auth/logout.service.js";
import {
  PREAUTH_COOKIE_NAME,
  SESSION_COOKIE_NAME,
} from "../src/auth/csrf.http.js";
import { VersionedHmacKeyring } from "../src/auth/keyring.js";
import { PostgresSessionCsrfTokenRepository } from "../src/auth/session-csrf-token.repository.js";
import { SessionTokenService } from "../src/auth/session-token.service.js";
import { generateOpaqueToken } from "../src/auth/token.js";
import { PostgresUserSessionRepository } from "../src/auth/user-session.repository.js";
import { PostgresUnitOfWork } from "../src/database/unit-of-work.js";
import { createUser, testUrls } from "./database.helpers.js";

let client: DatabaseClient | undefined;
let unitOfWork: PostgresUnitOfWork;
let logoutService: LogoutService;
let tokenService: SessionTokenService;

interface SessionFixture {
  readonly userId: number;
  readonly sessionId: number;
  readonly sessionToken: string;
  readonly csrfToken: string;
}

async function createSession(): Promise<SessionFixture> {
  const userId = await createUser(client!.sql);
  const sessionToken = generateOpaqueToken();
  const csrfToken = generateOpaqueToken();
  const sessionHash = tokenService.hash(sessionToken);
  const csrfHash = tokenService.hash(csrfToken);
  const rows = (await client!.sql`
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
      ${sessionHash.hash},
      ${sessionHash.keyVersion},
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
    throw new Error("logout session fixture insert returned no row");
  }
  const sessionId = rows[0]!.id;
  await client!.sql`
    INSERT INTO app.session_csrf_tokens (session_id, token_hash, expires_at)
    VALUES (${sessionId}, ${csrfHash.hash}, now() + interval '1 hour')
  `;
  return { userId, sessionId, sessionToken, csrfToken };
}

async function revokedAt(sessionId: number): Promise<Date | null> {
  const rows = (await client!.sql`
    SELECT revoked_at AS "revokedAt"
      FROM app.user_sessions
     WHERE id = ${sessionId}
  `) as unknown as readonly { revokedAt: Date | null }[];
  return rows[0]?.revokedAt ?? null;
}

beforeAll(async () => {
  client = createDatabaseClient(testUrls().runtime, {
    applicationName: "inpulse-logout-integration-test",
  });
  unitOfWork = new PostgresUnitOfWork(client);
  const keyring = VersionedHmacKeyring.fromEntries(
    [{ version: 1, key: randomBytes(32) }],
    1,
  );
  tokenService = new SessionTokenService(keyring);
  logoutService = new LogoutService(
    unitOfWork,
    new PostgresUserSessionRepository(),
    new PostgresSessionCsrfTokenRepository(),
    tokenService,
  );
});

afterAll(async () => {
  await client?.close();
});

describe("登出纵切片（真实 PostgreSQL）", () => {
  test("有效 Session 与正确 CSRF 撤销 Session 并清 Cookie", async () => {
    const fixture = await createSession();
    const result = await logoutService.logout({
      cookieHeader: `${SESSION_COOKIE_NAME}=${fixture.sessionToken}`,
      csrfToken: fixture.csrfToken,
    });

    expect(result.cookies).toEqual([
      { name: PREAUTH_COOKIE_NAME, value: null, maxAgeSeconds: 0 },
      { name: SESSION_COOKIE_NAME, value: null, maxAgeSeconds: 0 },
    ]);
    expect(await revokedAt(fixture.sessionId)).not.toBeNull();
  });

  test("已撤销 Session 重复登出只清 Cookie，不改变撤销时间", async () => {
    const fixture = await createSession();
    await logoutService.logout({
      cookieHeader: `${SESSION_COOKIE_NAME}=${fixture.sessionToken}`,
      csrfToken: fixture.csrfToken,
    });
    const revoked = await revokedAt(fixture.sessionId);

    const repeated = await logoutService.logout({
      cookieHeader: `${SESSION_COOKIE_NAME}=${fixture.sessionToken}`,
      csrfToken: undefined,
    });

    expect(repeated.cookies).toEqual([
      { name: PREAUTH_COOKIE_NAME, value: null, maxAgeSeconds: 0 },
      { name: SESSION_COOKIE_NAME, value: null, maxAgeSeconds: 0 },
    ]);
    expect(await revokedAt(fixture.sessionId)).toEqual(revoked);
  });

  test("CSRF 不匹配时不撤销 Session", async () => {
    const fixture = await createSession();
    await expect(
      logoutService.logout({
        cookieHeader: `${SESSION_COOKIE_NAME}=${fixture.sessionToken}`,
        csrfToken: "A".repeat(43),
      }),
    ).rejects.toMatchObject({ status: 403, code: "CSRF_TOKEN_INVALID" });
    expect(await revokedAt(fixture.sessionId)).toBeNull();
  });
});
