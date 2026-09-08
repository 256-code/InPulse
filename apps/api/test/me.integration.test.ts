import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  createDatabaseClient,
  type DatabaseClient,
} from "@inpulse/database/client";
import { VersionedHmacKeyring } from "../src/auth/keyring.js";
import { MeService } from "../src/auth/me.service.js";
import { SessionAuthService } from "../src/auth/session-auth.service.js";
import { SessionTokenService } from "../src/auth/session-token.service.js";
import { generateOpaqueToken } from "../src/auth/token.js";
import { PostgresUserProfileRepository } from "../src/auth/user-profile.repository.js";
import { PostgresUserSessionRepository } from "../src/auth/user-session.repository.js";
import { PostgresUnitOfWork } from "../src/database/unit-of-work.js";
import { createUser, testUrls } from "./database.helpers.js";

let client: DatabaseClient | undefined;
let unitOfWork: PostgresUnitOfWork;
let tokenService: SessionTokenService;
let meService: MeService;

async function issueSessionCookie(userId: number): Promise<string> {
  const token = generateOpaqueToken();
  const tokenHash = tokenService.hash(token).hash;
  await client!.sql`
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

beforeAll(async () => {
  client = createDatabaseClient(testUrls().runtime, {
    applicationName: "inpulse-me-integration-test",
  });
  unitOfWork = new PostgresUnitOfWork(client);
  const keyring = VersionedHmacKeyring.fromEntries(
    [{ version: 1, key: randomBytes(32) }],
    1,
  );
  tokenService = new SessionTokenService(keyring);
  const sessionAuthService = new SessionAuthService(
    unitOfWork,
    new PostgresUserSessionRepository(),
    tokenService,
  );
  meService = new MeService(
    unitOfWork,
    sessionAuthService,
    new PostgresUserProfileRepository(),
  );
});

afterAll(async () => {
  await client?.close();
});

describe("GET /me 当前用户资料（真实 PostgreSQL）", () => {
  test("有效认证 Session 返回当前用户资料", async () => {
    const userId = await createUser(client!.sql);
    const cookie = await issueSessionCookie(userId);

    await expect(meService.getCurrentUser(cookie)).resolves.toMatchObject({
      id: userId,
      isAdmin: false,
      status: "ACTIVE",
    });
  });

  test("停用用户的 Session 不返回资料", async () => {
    const userId = await createUser(client!.sql, { disabled: true });
    const cookie = await issueSessionCookie(userId);

    await expect(meService.getCurrentUser(cookie)).resolves.toBeUndefined();
  });

  test("缺少 Session Cookie 不查询用户资料", async () => {
    await expect(meService.getCurrentUser(undefined)).resolves.toBeUndefined();
  });
});
