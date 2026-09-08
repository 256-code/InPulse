import { randomBytes, randomUUID } from "node:crypto";

import { hash } from "@node-rs/argon2";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  createDatabaseClient,
  type DatabaseClient,
} from "@inpulse/database/client";
import { PostgresUserCredentialRepository } from "../src/auth/user-credential.repository.js";
import { PostgresUserSessionRepository } from "../src/auth/user-session.repository.js";
import { UserAuthInvalidationService } from "../src/auth/user-auth-invalidation.service.js";
import { PostgresUnitOfWork } from "../src/database/unit-of-work.js";
import { testUrls } from "./database.helpers.js";

const FIXTURE_PASSWORD = "invalidation-integration-password";

let client: DatabaseClient | undefined;
let unitOfWork: PostgresUnitOfWork;
let service: UserAuthInvalidationService;

async function createUserWithSessions(): Promise<number> {
  const loginName = `invalidate_${randomUUID().replaceAll("-", "")}`.slice(
    0,
    80,
  );
  const passwordHash = await hash(FIXTURE_PASSWORD, {
    memoryCost: 19 * 1024,
    timeCost: 2,
    parallelism: 1,
    outputLen: 32,
    algorithm: 2,
  });
  const [userRow] = (await client!.sql`
    INSERT INTO app.users (login_name, name, password_hash)
    VALUES (${loginName}, ${`Invalidate ${loginName}`}, ${passwordHash})
    RETURNING id
  `) as unknown as readonly { id: number }[];
  if (userRow === undefined) {
    throw new Error("invalidation fixture user insert returned no row");
  }

  for (const _ of [0, 1]) {
    await client!.sql`
      INSERT INTO app.user_sessions (
        user_id,
        token_hash,
        token_hash_key_version,
        auth_version_at_issue,
        auth_state,
        recovery_rotation_generation,
        recovery_rotation_consumed_generation,
        idle_expires_at,
        absolute_expires_at
      )
      VALUES (
        ${userRow.id},
        ${randomBytes(32)},
        1,
        1,
        'AUTHENTICATED',
        0,
        0,
        now() + interval '8 hours',
        now() + interval '7 days'
      )
    `;
  }
  return userRow.id;
}

beforeAll(async () => {
  client = createDatabaseClient(testUrls().runtime, {
    applicationName: "inpulse-user-auth-invalidation-integration-test",
  });
  unitOfWork = new PostgresUnitOfWork(client);
  service = new UserAuthInvalidationService(
    unitOfWork,
    new PostgresUserCredentialRepository(),
    new PostgresUserSessionRepository(),
  );
});

afterAll(async () => {
  await client?.close();
});

describe("用户 Session 统一失效（真实 PostgreSQL）", () => {
  test("同一事务递增 auth_version 并撤销全部 Session", async () => {
    const userId = await createUserWithSessions();

    const invalidated = await service.invalidateUserSessions(userId);
    expect(invalidated).toBe(true);

    const [userRow] = (await client!.sql`
      SELECT auth_version AS "authVersion", row_version AS "rowVersion"
        FROM app.users
       WHERE id = ${userId}
    `) as unknown as readonly { authVersion: number; rowVersion: number }[];
    expect(userRow).toMatchObject({ authVersion: 2, rowVersion: 2 });

    const [sessionRow] = (await client!.sql`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE revoked_at IS NOT NULL)::int AS revoked
        FROM app.user_sessions
       WHERE user_id = ${userId}
    `) as unknown as readonly { total: number; revoked: number }[];
    expect(sessionRow?.total).toBe(2);
    expect(sessionRow?.revoked).toBe(2);
  });

  test("再次失效只递增 auth_version，不重复撤销", async () => {
    const userId = await createUserWithSessions();
    await service.invalidateUserSessions(userId);

    const second = await service.invalidateUserSessions(userId);
    expect(second).toBe(true);

    const [userRow] = (await client!.sql`
      SELECT auth_version AS "authVersion"
        FROM app.users
       WHERE id = ${userId}
    `) as unknown as readonly { authVersion: number }[];
    expect(userRow?.authVersion).toBe(3);

    const [sessionRow] = (await client!.sql`
      SELECT count(*) FILTER (WHERE revoked_at IS NOT NULL)::int AS revoked
        FROM app.user_sessions
       WHERE user_id = ${userId}
    `) as unknown as readonly { revoked: number }[];
    expect(sessionRow?.revoked).toBe(2);
  });
});
