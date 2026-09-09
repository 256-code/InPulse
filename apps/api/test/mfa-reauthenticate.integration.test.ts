import { createHmac, randomBytes, randomUUID } from "node:crypto";

import { hash } from "@node-rs/argon2";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  createDatabaseClient,
  type DatabaseClient,
} from "@inpulse/database/client";
import { PostgresAuthRateLimitRepository } from "../src/auth/auth-rate-limit.repository.js";
import { LoginRateLimitService } from "../src/auth/auth-rate-limit.service.js";
import { VersionedHmacKeyring } from "../src/auth/keyring.js";
import { MfaRateLimitService } from "../src/auth/mfa-rate-limit.service.js";
import { MfaReauthenticateService } from "../src/auth/mfa-reauthenticate.service.js";
import { PasswordService } from "../src/auth/password.service.js";
import { PostgresSessionCsrfTokenRepository } from "../src/auth/session-csrf-token.repository.js";
import { SessionTokenService } from "../src/auth/session-token.service.js";
import { TotpService } from "../src/auth/totp.service.js";
import { VersionedAeadKeyring } from "../src/auth/totp-keyring.js";
import { generateOpaqueToken } from "../src/auth/token.js";
import { PostgresUserCredentialRepository } from "../src/auth/user-credential.repository.js";
import { PostgresUserSessionRepository } from "../src/auth/user-session.repository.js";
import { PostgresUserTotpFactorRepository } from "../src/auth/user-totp-factor.repository.js";
import { PostgresUnitOfWork } from "../src/database/unit-of-work.js";
import { testUrls } from "./database.helpers.js";

const REAUTH_PASSWORD = "integration-reauth-password";
const REAUTH_WRONG_PASSWORD = "wrong-password";

let client: DatabaseClient | undefined;
let unitOfWork: PostgresUnitOfWork;
let tokenService: SessionTokenService;
let totpService: TotpService;
let loginRateLimitService: LoginRateLimitService;
let mfaRateLimitService: MfaRateLimitService;
let reauthService: MfaReauthenticateService;

async function createActiveAdmin(): Promise<{
  readonly userId: number;
  readonly loginName: string;
  readonly secret: string;
}> {
  const loginName = `reauth_${randomUUID().replaceAll("-", "")}`.slice(0, 80);
  const passwordHash = await hash(REAUTH_PASSWORD, {
    memoryCost: 19 * 1024,
    timeCost: 2,
    parallelism: 1,
    outputLen: 32,
    algorithm: 2,
  });
  const [row] = (await client!.sql`
    INSERT INTO app.users (
      login_name,
      name,
      password_hash,
      is_admin,
      status
    )
    VALUES (
      ${loginName},
      ${`Reauth ${loginName}`},
      ${passwordHash},
      true,
      'ACTIVE'
    )
    RETURNING id
  `) as unknown as readonly { id: number }[];
  if (row === undefined) {
    throw new Error("reauthenticate fixture user insert returned no row");
  }
  const userId = row.id;
  const secret = totpService.generateSecretBase32();
  const encrypted = totpService.encryptSecret(secret);
  const factorRepository = new PostgresUserTotpFactorRepository();
  await unitOfWork.run(async (tx) => {
    await factorRepository.insertPending(tx, userId, 1, encrypted);
    await factorRepository.activate(tx, userId, 1, 0);
  });
  return { userId, loginName, secret };
}

async function createSession(
  userId: number,
  authVersion: number,
  authState: "AUTHENTICATED" | "MFA_CHALLENGE",
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
      authState,
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
  return rows[0]!.authVersion;
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
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

async function reauthState(sessionId: number): Promise<{
  readonly reauthenticatedAt: string | null;
  readonly mfaVerifiedAt: string | null;
  readonly rotationGeneration: number;
}> {
  const rows = (await client!.sql`
    SELECT reauthenticated_at::text AS "reauthenticatedAt",
           mfa_verified_at::text AS "mfaVerifiedAt",
           recovery_rotation_generation AS "rotationGeneration"
      FROM app.user_sessions
     WHERE id = ${sessionId}
  `) as unknown as readonly {
    readonly reauthenticatedAt: string | null;
    readonly mfaVerifiedAt: string | null;
    readonly rotationGeneration: number;
  }[];
  return rows[0]!;
}

async function acceptedStep(userId: number): Promise<number> {
  const rows = (await client!.sql`
    SELECT last_accepted_step::text AS "step"
      FROM app.user_totp_factors
     WHERE user_id = ${userId}
  `) as unknown as readonly { step: string | null }[];
  return rows[0]!.step === null ? 0 : Number.parseInt(rows[0]!.step, 10);
}

async function countBuckets(bucketType: "ACCOUNT" | "MFA"): Promise<number> {
  const rows = (await client!.sql`
    SELECT count(*)::int AS "count"
      FROM app.auth_rate_limit_buckets
     WHERE bucket_type = ${bucketType}
  `) as unknown as readonly { count: number }[];
  return rows[0]!.count;
}

beforeAll(async () => {
  client = createDatabaseClient(testUrls().runtime, {
    applicationName: "inpulse-mfa-reauthenticate-integration-test",
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
  totpService = new TotpService(aeadKeyring);
  loginRateLimitService = new LoginRateLimitService(
    unitOfWork,
    new PostgresAuthRateLimitRepository(),
    hmacKeyring,
  );
  mfaRateLimitService = new MfaRateLimitService(
    unitOfWork,
    new PostgresAuthRateLimitRepository(),
    hmacKeyring,
  );
  reauthService = new MfaReauthenticateService(
    unitOfWork,
    new PostgresUserCredentialRepository(),
    new PostgresUserTotpFactorRepository(),
    new PostgresUserSessionRepository(),
    new PostgresSessionCsrfTokenRepository(),
    tokenService,
    new PasswordService(),
    totpService,
    loginRateLimitService,
    mfaRateLimitService,
  );
});

afterAll(async () => {
  await client?.close();
});

describe("管理员重认证（真实 PostgreSQL）", () => {
  test("密码与当前 TOTP 通过后原子刷新双时间戳并递增 rotation generation", async () => {
    const admin = await createActiveAdmin();
    const session = await createSession(
      admin.userId,
      await authVersionFor(admin.userId),
      "AUTHENTICATED",
    );
    const nowMs = Date.now();
    const expectedStep = Math.floor(nowMs / 30_000);

    await reauthService.reauthenticate({
      password: REAUTH_PASSWORD,
      code: totpCode(admin.secret, nowMs),
      clientIp: "198.51.100.30",
      cookieHeader: cookieFor(session.sessionToken),
      csrfToken: session.csrfToken,
    });

    const state = await reauthState(session.sessionId);
    expect(state.reauthenticatedAt).not.toBeNull();
    expect(state.mfaVerifiedAt).toBe(state.reauthenticatedAt);
    expect(state.rotationGeneration).toBe(1);
    expect(await acceptedStep(admin.userId)).toBe(expectedStep);
  });

  test("错误密码返回 401、不刷新时间戳并写入登录限流", async () => {
    const admin = await createActiveAdmin();
    const session = await createSession(
      admin.userId,
      await authVersionFor(admin.userId),
      "AUTHENTICATED",
    );

    await expect(
      reauthService.reauthenticate({
        password: REAUTH_WRONG_PASSWORD,
        code: totpCode(admin.secret),
        clientIp: "198.51.100.31",
        cookieHeader: cookieFor(session.sessionToken),
        csrfToken: session.csrfToken,
      }),
    ).rejects.toMatchObject({ status: 401, code: "INVALID_PASSWORD" });

    const state = await reauthState(session.sessionId);
    expect(state.reauthenticatedAt).toBeNull();
    expect(state.rotationGeneration).toBe(0);
    expect(await countBuckets("ACCOUNT")).toBeGreaterThan(0);
  });

  test("错误 TOTP 返回 401、不刷新时间戳并写入 MFA 限流", async () => {
    const admin = await createActiveAdmin();
    const session = await createSession(
      admin.userId,
      await authVersionFor(admin.userId),
      "AUTHENTICATED",
    );

    await expect(
      reauthService.reauthenticate({
        password: REAUTH_PASSWORD,
        code: wrongCode(admin.secret),
        clientIp: "198.51.100.32",
        cookieHeader: cookieFor(session.sessionToken),
        csrfToken: session.csrfToken,
      }),
    ).rejects.toMatchObject({ status: 401, code: "INVALID_TOTP_CODE" });

    const state = await reauthState(session.sessionId);
    expect(state.reauthenticatedAt).toBeNull();
    expect(state.rotationGeneration).toBe(0);
    expect(await countBuckets("MFA")).toBeGreaterThan(0);
  });

  test("MFA_CHALLENGE 受限 Session 返回 403", async () => {
    const admin = await createActiveAdmin();
    const session = await createSession(
      admin.userId,
      await authVersionFor(admin.userId),
      "MFA_CHALLENGE",
    );

    await expect(
      reauthService.reauthenticate({
        password: REAUTH_PASSWORD,
        code: totpCode(admin.secret),
        clientIp: "198.51.100.33",
        cookieHeader: cookieFor(session.sessionToken),
        csrfToken: session.csrfToken,
      }),
    ).rejects.toMatchObject({
      status: 403,
      code: "ADMIN_REAUTH_SESSION_REQUIRED",
    });

    const state = await reauthState(session.sessionId);
    expect(state.reauthenticatedAt).toBeNull();
    expect(state.rotationGeneration).toBe(0);
  });

  test("同一 TOTP time-step 不能重放", async () => {
    const admin = await createActiveAdmin();
    const session = await createSession(
      admin.userId,
      await authVersionFor(admin.userId),
      "AUTHENTICATED",
    );
    const nowMs = Date.now();
    const code = totpCode(admin.secret, nowMs);
    const input = {
      password: REAUTH_PASSWORD,
      code,
      clientIp: "198.51.100.34",
      cookieHeader: cookieFor(session.sessionToken),
      csrfToken: session.csrfToken,
    };

    await reauthService.reauthenticate(input);
    await expect(reauthService.reauthenticate(input)).rejects.toMatchObject({
      status: 401,
      code: "INVALID_TOTP_CODE",
    });
  });

  test("达到 MFA 限流阈值后返回 429", async () => {
    const admin = await createActiveAdmin();
    const session = await createSession(
      admin.userId,
      await authVersionFor(admin.userId),
      "AUTHENTICATED",
    );
    const clientIp = "198.51.100.35";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await mfaRateLimitService.recordFailure(admin.userId, clientIp);
    }

    await expect(
      reauthService.reauthenticate({
        password: REAUTH_PASSWORD,
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
