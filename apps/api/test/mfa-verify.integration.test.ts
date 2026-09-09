import { createHmac, randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  createDatabaseClient,
  type DatabaseClient,
} from "@inpulse/database/client";
import { PostgresAuthRateLimitRepository } from "../src/auth/auth-rate-limit.repository.js";
import { VersionedHmacKeyring } from "../src/auth/keyring.js";
import { MfaRateLimitService } from "../src/auth/mfa-rate-limit.service.js";
import { MfaVerifyService } from "../src/auth/mfa-verify.service.js";
import { PostgresSessionCsrfTokenRepository } from "../src/auth/session-csrf-token.repository.js";
import { SessionTokenService } from "../src/auth/session-token.service.js";
import { TotpService } from "../src/auth/totp.service.js";
import { VersionedAeadKeyring } from "../src/auth/totp-keyring.js";
import { generateOpaqueToken } from "../src/auth/token.js";
import { PostgresUserCredentialRepository } from "../src/auth/user-credential.repository.js";
import { PostgresUserSessionRepository } from "../src/auth/user-session.repository.js";
import { PostgresUserTotpFactorRepository } from "../src/auth/user-totp-factor.repository.js";
import { PostgresUnitOfWork } from "../src/database/unit-of-work.js";
import { createUser, testUrls } from "./database.helpers.js";

let client: DatabaseClient | undefined;
let unitOfWork: PostgresUnitOfWork;
let tokenService: SessionTokenService;
let totpService: TotpService;
let verifyService: MfaVerifyService;
let rateLimitService: MfaRateLimitService;

async function createActiveAdmin(): Promise<{
  readonly userId: number;
  readonly secret: string;
}> {
  const userId = await createUser(client!.sql, { admin: true });
  const secret = totpService.generateSecretBase32();
  const encrypted = totpService.encryptSecret(secret);
  const factorRepository = new PostgresUserTotpFactorRepository();
  await unitOfWork.run(async (tx) => {
    await factorRepository.insertPending(tx, userId, 1, encrypted);
    await factorRepository.activate(tx, userId, 1, 0);
  });
  return { userId, secret };
}

async function createActiveNonAdmin(): Promise<{
  readonly userId: number;
  readonly secret: string;
}> {
  const userId = await createUser(client!.sql);
  const secret = totpService.generateSecretBase32();
  const encrypted = totpService.encryptSecret(secret);
  const factorRepository = new PostgresUserTotpFactorRepository();
  await unitOfWork.run(async (tx) => {
    await factorRepository.insertPending(tx, userId, 1, encrypted);
    await factorRepository.activate(tx, userId, 1, 0);
  });
  return { userId, secret };
}

async function createChallengeSession(
  userId: number,
  authVersion: number,
): Promise<{
  readonly sessionId: number;
  readonly sessionToken: string;
  readonly csrfToken: string;
}> {
  const sessionToken = generateOpaqueToken();
  const csrfToken = generateOpaqueToken();
  const sessionHash = tokenService.hash(sessionToken);
  const csrfHash = tokenService.hash(csrfToken);
  const created = await unitOfWork.run(async (tx) => {
    const sessionRepository = new PostgresUserSessionRepository();
    const csrfRepository = new PostgresSessionCsrfTokenRepository();
    const session = await sessionRepository.create(tx, {
      userId,
      tokenHash: sessionHash.hash,
      tokenHashKeyVersion: sessionHash.keyVersion,
      authVersionAtIssue: authVersion,
      authState: "MFA_CHALLENGE",
      idleExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      absoluteExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    await csrfRepository.issue(tx, {
      sessionId: session.id,
      tokenHash: csrfHash.hash,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });
    return session;
  });
  return {
    sessionId: created.id,
    sessionToken,
    csrfToken,
  };
}

async function authVersionFor(userId: number): Promise<number> {
  const rows = (await client!.sql`
    SELECT auth_version AS "authVersion"
      FROM app.users
     WHERE id = ${userId}
  `) as unknown as readonly { authVersion: number }[];
  const row = rows[0];
  if (!row) {
    throw new Error(`User ${userId} not found`);
  }
  return row.authVersion;
}

function cookieFor(token: string): string {
  return `__Host-session=${token}`;
}

function totpCode(secret: string, nowMs = Date.now()): string {
  const secretBytes = decodeBase32(secret);
  const step = Math.floor(nowMs / 30_000);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step), 0);
  const digest = createHmac("sha1", secretBytes).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    (digest[offset + 1]! << 16) |
    (digest[offset + 2]! << 8) |
    digest[offset + 3]!;
  return (binary % 1_000_000).toString().padStart(6, "0");
}

function wrongCode(secret: string): string {
  const code = totpCode(secret);
  return code === "000000" ? "000001" : "000000";
}

function decodeBase32(input: string): Buffer {
  const normalized = input.replace(/=+$/u, "").toUpperCase();
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const output: number[] = [];
  let bits = 0;
  let value = 0;
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) {
      throw new Error("invalid Base32 in test helper");
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

async function assertSessionState(
  sessionId: number,
  expectedState: string,
): Promise<{
  readonly state: string;
  readonly mfaVerifiedAt: string | null;
}> {
  const rows = (await client!.sql`
    SELECT auth_state AS state,
           mfa_verified_at::text AS "mfaVerifiedAt"
      FROM app.user_sessions
     WHERE id = ${sessionId}
  `) as unknown as readonly {
    state: string;
    mfaVerifiedAt: string | null;
  }[];
  const row = rows[0];
  expect(row?.state).toBe(expectedState);
  return row ?? { state: expectedState, mfaVerifiedAt: null };
}

async function assertAcceptedStep(
  userId: number,
  expectedStep: number,
): Promise<void> {
  const rows = (await client!.sql`
    SELECT last_accepted_step::text AS "lastAcceptedStep"
      FROM app.user_totp_factors
     WHERE user_id = ${userId}
  `) as unknown as readonly { lastAcceptedStep: string | null }[];
  expect(rows[0]?.lastAcceptedStep).toBe(String(expectedStep));
}

async function countMfaBuckets(): Promise<number> {
  const rows = (await client!.sql`
    SELECT count(*)::int AS count
      FROM app.auth_rate_limit_buckets
     WHERE bucket_type = 'MFA'
  `) as unknown as readonly { count: number }[];
  return rows[0]?.count ?? 0;
}

beforeAll(async () => {
  client = createDatabaseClient(testUrls().runtime, {
    applicationName: "inpulse-mfa-verify-integration-test",
  });
  unitOfWork = new PostgresUnitOfWork(client);
  const hmacKeyring = VersionedHmacKeyring.fromEntries(
    [{ version: 1, key: randomBytes(32) }],
    1,
  );
  tokenService = new SessionTokenService(hmacKeyring);
  const aeadKeyring = VersionedAeadKeyring.fromEntries(
    [{ version: 1, key: randomBytes(32) }],
    1,
  );
  totpService = new TotpService(aeadKeyring);
  rateLimitService = new MfaRateLimitService(
    unitOfWork,
    new PostgresAuthRateLimitRepository(),
    hmacKeyring,
  );
  verifyService = new MfaVerifyService(
    unitOfWork,
    new PostgresUserCredentialRepository(),
    new PostgresUserTotpFactorRepository(),
    new PostgresUserSessionRepository(),
    new PostgresSessionCsrfTokenRepository(),
    tokenService,
    totpService,
    rateLimitService,
  );
});

afterAll(async () => {
  await client?.close();
});

describe("管理员 MFA 验证（真实 PostgreSQL）", () => {
  test("有效 TOTP 成功后升级 Session 并记录防重放 step", async () => {
    const admin = await createActiveAdmin();
    const session = await createChallengeSession(
      admin.userId,
      await authVersionFor(admin.userId),
    );
    const nowMs = Date.now();
    const expectedStep = Math.floor(nowMs / 30_000);
    const code = totpCode(admin.secret, nowMs);

    const result = await verifyService.verify({
      code,
      clientIp: "198.51.100.21",
      cookieHeader: cookieFor(session.sessionToken),
      csrfToken: session.csrfToken,
    });

    expect(result.authState).toBe("AUTHENTICATED");
    expect(result.csrfToken).toHaveLength(43);
    const sessionState = await assertSessionState(
      session.sessionId,
      "AUTHENTICATED",
    );
    expect(sessionState.mfaVerifiedAt).toBeNull();
    await assertAcceptedStep(admin.userId, expectedStep);
  });

  test("错误 TOTP 返回 401、不升级并写入 MFA 限流", async () => {
    const admin = await createActiveAdmin();
    const session = await createChallengeSession(
      admin.userId,
      await authVersionFor(admin.userId),
    );

    await expect(
      verifyService.verify({
        code: wrongCode(admin.secret),
        clientIp: "198.51.100.22",
        cookieHeader: cookieFor(session.sessionToken),
        csrfToken: session.csrfToken,
      }),
    ).rejects.toMatchObject({ status: 401, code: "INVALID_TOTP_CODE" });

    await assertSessionState(session.sessionId, "MFA_CHALLENGE");
    await assertAcceptedStep(admin.userId, 0);
    expect(await countMfaBuckets()).toBeGreaterThan(0);
  });

  test("完整 Session 调用返回 409", async () => {
    const admin = await createActiveAdmin();
    const session = await createChallengeSession(
      admin.userId,
      await authVersionFor(admin.userId),
    );
    await client!.sql`
      UPDATE app.user_sessions
         SET auth_state = 'AUTHENTICATED'
       WHERE id = ${session.sessionId}
    `;

    await expect(
      verifyService.verify({
        code: totpCode(admin.secret),
        clientIp: "198.51.100.23",
        cookieHeader: cookieFor(session.sessionToken),
        csrfToken: session.csrfToken,
      }),
    ).rejects.toMatchObject({ status: 409, code: "MFA_VERIFY_CONFLICT" });
  });

  test("非管理员受限 Session 返回 403", async () => {
    const user = await createActiveNonAdmin();
    const session = await createChallengeSession(
      user.userId,
      await authVersionFor(user.userId),
    );

    await expect(
      verifyService.verify({
        code: totpCode(user.secret),
        clientIp: "198.51.100.24",
        cookieHeader: cookieFor(session.sessionToken),
        csrfToken: session.csrfToken,
      }),
    ).rejects.toMatchObject({ status: 403, code: "MFA_ADMIN_REQUIRED" });
  });

  test("同一 TOTP time-step 并发只有一个成功", async () => {
    const admin = await createActiveAdmin();
    const session = await createChallengeSession(
      admin.userId,
      await authVersionFor(admin.userId),
    );
    const code = totpCode(admin.secret);

    const results = await Promise.allSettled([
      verifyService.verify({
        code,
        clientIp: "198.51.100.25",
        cookieHeader: cookieFor(session.sessionToken),
        csrfToken: session.csrfToken,
      }),
      verifyService.verify({
        code,
        clientIp: "198.51.100.25",
        cookieHeader: cookieFor(session.sessionToken),
        csrfToken: session.csrfToken,
      }),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toMatchObject({ status: 409 });
  });

  test("达到 MFA 限流阈值后返回 429", async () => {
    const admin = await createActiveAdmin();
    const session = await createChallengeSession(
      admin.userId,
      await authVersionFor(admin.userId),
    );
    const clientIp = "198.51.100.26";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await rateLimitService.recordFailure(admin.userId, clientIp);
    }

    await expect(
      verifyService.verify({
        code: totpCode(admin.secret),
        clientIp,
        cookieHeader: cookieFor(session.sessionToken),
        csrfToken: session.csrfToken,
      }),
    ).rejects.toMatchObject({
      status: 429,
      code: "MFA_VERIFY_RATE_LIMITED",
    });
  });
});
