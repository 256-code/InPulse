import { createHmac, randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  createDatabaseClient,
  type DatabaseClient,
} from "@inpulse/database/client";
import { PostgresAuthRateLimitRepository } from "../src/auth/auth-rate-limit.repository.js";
import { VersionedHmacKeyring } from "../src/auth/keyring.js";
import { MfaEnrollmentService } from "../src/auth/mfa-enrollment.service.js";
import { MfaRateLimitService } from "../src/auth/mfa-rate-limit.service.js";
import { PostgresMfaRecoveryCodeRepository } from "../src/auth/mfa-recovery-code.repository.js";
import { RecoveryCodeService } from "../src/auth/recovery-code.service.js";
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
let mfaService: MfaEnrollmentService;
let mfaRateLimitService: MfaRateLimitService;

async function createAdmin(): Promise<{
  readonly userId: number;
  readonly authVersion: number;
}> {
  const userId = await createUser(client!.sql, { admin: true });
  const rows = (await client!.sql`
    SELECT auth_version AS "authVersion"
      FROM app.users
     WHERE id = ${userId}
  `) as unknown as readonly { authVersion: number }[];
  return { userId, authVersion: rows[0]!.authVersion };
}

async function createEnrollmentSession(userId: number, authVersion: number) {
  const sessionToken = generateOpaqueToken();
  const csrfToken = generateOpaqueToken();
  const sessionHash = tokenService.hash(sessionToken);
  const csrfHash = tokenService.hash(csrfToken);
  const created = await unitOfWork.run((tx) =>
    new PostgresUserSessionRepository().create(tx, {
      userId,
      tokenHash: sessionHash.hash,
      tokenHashKeyVersion: sessionHash.keyVersion,
      authVersionAtIssue: authVersion,
      authState: "MFA_ENROLLMENT",
      idleExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      absoluteExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    }),
  );
  await unitOfWork.run((tx) =>
    new PostgresSessionCsrfTokenRepository().issue(tx, {
      sessionId: created.id,
      tokenHash: csrfHash.hash,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    }),
  );
  return {
    sessionId: created.id,
    sessionToken,
    csrfToken,
  };
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

async function assertRejectedWithStatus(
  results: readonly PromiseSettledResult<unknown>[],
  statuses: readonly number[],
): Promise<void> {
  const rejected = results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  expect(rejected).toHaveLength(1);
  expect(statuses).toContain(
    (rejected[0]!.reason as { status: number }).status,
  );
}

beforeAll(async () => {
  client = createDatabaseClient(testUrls().runtime, {
    applicationName: "inpulse-mfa-enrollment-integration-test",
  });
  unitOfWork = new PostgresUnitOfWork(client);
  const hmacKeyring = VersionedHmacKeyring.fromEntries(
    [{ version: 1, key: randomBytes(32) }],
    1,
  );
  const aeadKeyring = VersionedAeadKeyring.fromEntries(
    [{ version: 1, key: randomBytes(32) }],
    1,
  );
  tokenService = new SessionTokenService(hmacKeyring);
  const rateRepository = new PostgresAuthRateLimitRepository();
  mfaRateLimitService = new MfaRateLimitService(
    unitOfWork,
    rateRepository,
    hmacKeyring,
  );
  mfaService = new MfaEnrollmentService(
    unitOfWork,
    new PostgresUserCredentialRepository(),
    new PostgresUserTotpFactorRepository(),
    new PostgresUserSessionRepository(),
    new PostgresSessionCsrfTokenRepository(),
    new PostgresMfaRecoveryCodeRepository(),
    tokenService,
    new TotpService(aeadKeyring),
    new RecoveryCodeService(),
    mfaRateLimitService,
  );
});

afterAll(async () => {
  await client?.close();
});

describe("MFA 注册纵切片（真实 PostgreSQL）", () => {
  test("start 后 confirm 原子启用因子、签发恢复码并轮换完整 Session", async () => {
    const admin = await createAdmin();
    const session = await createEnrollmentSession(
      admin.userId,
      admin.authVersion,
    );
    const started = await mfaService.start({
      expectedEnrollmentGeneration: 0,
      cookieHeader: cookieFor(session.sessionToken),
      csrfToken: session.csrfToken,
    });
    const code = totpCode(started.secret);
    const confirmed = await mfaService.confirm({
      expectedEnrollmentGeneration: started.enrollmentGeneration,
      code,
      clientIp: "198.51.100.10",
      cookieHeader: cookieFor(session.sessionToken),
      csrfToken: session.csrfToken,
    });

    expect(confirmed.authState).toBe("AUTHENTICATED");
    expect(confirmed.recoveryCodes).toHaveLength(10);
    expect(confirmed.cookies).toHaveLength(2);

    const factor = (await client!.sql`
      SELECT status, enrollment_generation::text AS "generation",
             ciphertext, auth_tag, last_accepted_step::text AS "step",
             enrolled_at IS NOT NULL AS "enrolled"
        FROM app.user_totp_factors
       WHERE user_id = ${admin.userId}
    `) as unknown as readonly {
      status: string;
      generation: string;
      ciphertext: Buffer;
      authTag: Buffer;
      step: string;
      enrolled: boolean;
    }[];
    expect(factor[0]).toMatchObject({
      status: "ACTIVE",
      generation: "1",
      step: expect.any(String),
      enrolled: true,
    });
    expect(factor[0]!.ciphertext.toString("base64")).not.toContain(
      started.secret,
    );

    const recovery = (await client!.sql`
      SELECT code_hash AS "codeHash"
        FROM app.mfa_recovery_codes
       WHERE user_id = ${admin.userId}
         AND batch_version = 1
    `) as unknown as readonly { codeHash: string }[];
    expect(recovery).toHaveLength(10);
    for (const row of recovery) {
      expect(row.codeHash.startsWith("$argon2id$")).toBe(true);
      expect(
        confirmed.recoveryCodes.some((codeValue) =>
          row.codeHash.includes(codeValue),
        ),
      ).toBe(false);
    }

    const sessions = (await client!.sql`
      SELECT id, auth_state AS "authState", revoked_at AS "revokedAt"
        FROM app.user_sessions
       WHERE user_id = ${admin.userId}
       ORDER BY id
    `) as unknown as readonly {
      id: number;
      authState: string;
      revokedAt: Date | null;
    }[];
    expect(sessions).toHaveLength(2);
    expect(sessions[0]?.id).toBe(session.sessionId);
    expect(sessions[0]?.revokedAt).toBeTruthy();
    expect(sessions[1]).toMatchObject({
      authState: "AUTHENTICATED",
      revokedAt: null,
    });
  });

  test("错误验证码不启用因子，并写入 MFA 限流桶", async () => {
    const admin = await createAdmin();
    const session = await createEnrollmentSession(
      admin.userId,
      admin.authVersion,
    );
    const started = await mfaService.start({
      expectedEnrollmentGeneration: 0,
      cookieHeader: cookieFor(session.sessionToken),
      csrfToken: session.csrfToken,
    });

    await expect(
      mfaService.confirm({
        expectedEnrollmentGeneration: started.enrollmentGeneration,
        code: "000000",
        clientIp: "198.51.100.11",
        cookieHeader: cookieFor(session.sessionToken),
        csrfToken: session.csrfToken,
      }),
    ).rejects.toMatchObject({ status: 401, code: "INVALID_TOTP_CODE" });

    const factor = (await client!.sql`
      SELECT status
        FROM app.user_totp_factors
       WHERE user_id = ${admin.userId}
    `) as unknown as readonly { status: string }[];
    expect(factor[0]?.status).toBe("ENROLLING");

    const buckets = (await client!.sql`
      SELECT count(*)::int AS "count"
        FROM app.auth_rate_limit_buckets
       WHERE bucket_type = 'MFA'
    `) as unknown as readonly { count: number }[];
    expect(buckets[0]?.count ?? 0).toBeGreaterThan(0);
  });

  test("MFA 验证失败达到用户阈值后返回 429", async () => {
    const admin = await createAdmin();
    const clientIp = "198.51.100.14";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await mfaRateLimitService.recordFailure(admin.userId, clientIp);
    }

    await expect(
      unitOfWork.run((tx) =>
        mfaRateLimitService.assertAllowed(tx, admin.userId, clientIp),
      ),
    ).rejects.toMatchObject({
      status: 429,
      code: "MFA_VERIFY_RATE_LIMITED",
    });
  });

  test("跨 Session start-vs-start 只有一个请求创建 pending", async () => {
    const admin = await createAdmin();
    const first = await createEnrollmentSession(
      admin.userId,
      admin.authVersion,
    );
    const second = await createEnrollmentSession(
      admin.userId,
      admin.authVersion,
    );

    const results = await Promise.allSettled([
      mfaService.start({
        expectedEnrollmentGeneration: 0,
        cookieHeader: cookieFor(first.sessionToken),
        csrfToken: first.csrfToken,
      }),
      mfaService.start({
        expectedEnrollmentGeneration: 0,
        cookieHeader: cookieFor(second.sessionToken),
        csrfToken: second.csrfToken,
      }),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);
    await assertRejectedWithStatus(results, [409]);
  });

  test("跨 Session start-vs-confirm 与同验证码并发均只有一个 2xx", async () => {
    const admin = await createAdmin();
    const first = await createEnrollmentSession(
      admin.userId,
      admin.authVersion,
    );
    const second = await createEnrollmentSession(
      admin.userId,
      admin.authVersion,
    );
    const started = await mfaService.start({
      expectedEnrollmentGeneration: 0,
      cookieHeader: cookieFor(first.sessionToken),
      csrfToken: first.csrfToken,
    });
    const code = totpCode(started.secret);

    const competition = await Promise.allSettled([
      mfaService.confirm({
        expectedEnrollmentGeneration: started.enrollmentGeneration,
        code,
        clientIp: "198.51.100.12",
        cookieHeader: cookieFor(first.sessionToken),
        csrfToken: first.csrfToken,
      }),
      mfaService.start({
        expectedEnrollmentGeneration: started.enrollmentGeneration,
        cookieHeader: cookieFor(second.sessionToken),
        csrfToken: second.csrfToken,
      }),
    ]);
    const competitionFulfilled = competition.filter(
      (result) => result.status === "fulfilled",
    );
    expect(competitionFulfilled).toHaveLength(1);
    await assertRejectedWithStatus(competition, [409]);

    const replayAdmin = await createAdmin();
    const replaySession = await createEnrollmentSession(
      replayAdmin.userId,
      replayAdmin.authVersion,
    );
    const replayStarted = await mfaService.start({
      expectedEnrollmentGeneration: 0,
      cookieHeader: cookieFor(replaySession.sessionToken),
      csrfToken: replaySession.csrfToken,
    });
    const replayCode = totpCode(replayStarted.secret);
    const replay = await Promise.allSettled([
      mfaService.confirm({
        expectedEnrollmentGeneration: replayStarted.enrollmentGeneration,
        code: replayCode,
        clientIp: "198.51.100.13",
        cookieHeader: cookieFor(replaySession.sessionToken),
        csrfToken: replaySession.csrfToken,
      }),
      mfaService.confirm({
        expectedEnrollmentGeneration: replayStarted.enrollmentGeneration,
        code: replayCode,
        clientIp: "198.51.100.13",
        cookieHeader: cookieFor(replaySession.sessionToken),
        csrfToken: replaySession.csrfToken,
      }),
    ]);
    expect(
      replay.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    await assertRejectedWithStatus(replay, [401, 409]);
  });

  test("管理员 MFA 被禁用后可以重新注册并重新启用", async () => {
    const admin = await createAdmin();
    const factorRepository = new PostgresUserTotpFactorRepository();
    await unitOfWork.run(async (tx) => {
      await factorRepository.insertPending(tx, admin.userId, 1, {
        keyVersion: 1,
        nonce: Buffer.alloc(12),
        ciphertext: Buffer.from("test"),
        authTag: Buffer.alloc(16),
      });
      await factorRepository.activate(tx, admin.userId, 1, 0);
      await factorRepository.disable(tx, admin.userId);
    });
    const session = await createEnrollmentSession(
      admin.userId,
      admin.authVersion,
    );

    const started = await mfaService.start({
      expectedEnrollmentGeneration: 1,
      cookieHeader: cookieFor(session.sessionToken),
      csrfToken: session.csrfToken,
    });
    expect(started.enrollmentGeneration).toBe(2);

    const confirmed = await mfaService.confirm({
      expectedEnrollmentGeneration: started.enrollmentGeneration,
      code: totpCode(started.secret),
      clientIp: "198.51.100.70",
      cookieHeader: cookieFor(session.sessionToken),
      csrfToken: session.csrfToken,
    });
    expect(confirmed.authState).toBe("AUTHENTICATED");

    const rows = (await client!.sql`
      SELECT status
        FROM app.user_totp_factors
       WHERE user_id = ${admin.userId}
    `) as unknown as readonly { status: string }[];
    expect(rows[0]!.status).toBe("ACTIVE");
  });
});
