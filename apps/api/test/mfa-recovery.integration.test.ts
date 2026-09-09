import { randomBytes, randomUUID } from "node:crypto";

import {
  createDatabaseClient,
  type DatabaseClient,
} from "@inpulse/database/client";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { PostgresAuditWritePort } from "../src/audit/postgres-audit-write-port.js";
import { AdminHighRiskAuthService } from "../src/auth/admin-high-risk.service.js";
import { PostgresAuthRateLimitRepository } from "../src/auth/auth-rate-limit.repository.js";
import { VersionedHmacKeyring } from "../src/auth/keyring.js";
import { MfaRateLimitService } from "../src/auth/mfa-rate-limit.service.js";
import { PostgresMfaRecoveryCodeRepository } from "../src/auth/mfa-recovery-code.repository.js";
import { MfaRecoveryService } from "../src/auth/mfa-recovery.service.js";
import { RecoveryCodeService } from "../src/auth/recovery-code.service.js";
import { PostgresSessionCsrfTokenRepository } from "../src/auth/session-csrf-token.repository.js";
import { SessionTokenService } from "../src/auth/session-token.service.js";
import { generateOpaqueToken } from "../src/auth/token.js";
import { PostgresUserCredentialRepository } from "../src/auth/user-credential.repository.js";
import { PostgresUserSessionRepository } from "../src/auth/user-session.repository.js";
import { PostgresUserTotpFactorRepository } from "../src/auth/user-totp-factor.repository.js";
import { PostgresUnitOfWork } from "../src/database/unit-of-work.js";
import { createUser, testUrls } from "./database.helpers.js";

let client: DatabaseClient | undefined;
let auditReader: DatabaseClient | undefined;
let unitOfWork: PostgresUnitOfWork;
let tokenService: SessionTokenService;
let recoveryService: MfaRecoveryService;
let recoveryCodeService: RecoveryCodeService;
let recoveryRepository: PostgresMfaRecoveryCodeRepository;
let factorRepository: PostgresUserTotpFactorRepository;

async function authVersionFor(userId: number): Promise<number> {
  const rows = (await client!.sql`
    SELECT auth_version AS "authVersion"
      FROM app.users
     WHERE id = ${userId}
  `) as unknown as readonly { authVersion: number }[];
  return rows[0]!.authVersion;
}

async function createAdminWithFactor(
  isAdmin = true,
): Promise<{ readonly userId: number; readonly authVersion: number }> {
  const userId = await createUser(client!.sql, { admin: isAdmin });
  const authVersion = await authVersionFor(userId);
  await unitOfWork.run(async (tx) => {
    const encrypted = {
      keyVersion: 1,
      nonce: Buffer.alloc(12),
      ciphertext: Buffer.from("test"),
      authTag: Buffer.alloc(16),
    };
    await factorRepository.insertPending(tx, userId, 1, encrypted);
    await factorRepository.activate(tx, userId, 1, 0);
  });
  return { userId, authVersion };
}

async function createSession(
  userId: number,
  authVersion: number,
  authState: "RECOVERY_CHALLENGE" | "AUTHENTICATED",
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

async function refreshReauthentication(sessionId: number): Promise<void> {
  await unitOfWork.run((tx) =>
    new PostgresUserSessionRepository().refreshReauthentication(tx, sessionId),
  );
}

async function issueRecoveryCodes(
  userId: number,
  batchVersion: number,
): Promise<readonly string[]> {
  const batch = await recoveryCodeService.issueBatch();
  await unitOfWork.run((tx) =>
    recoveryRepository.issueBatch(tx, userId, batchVersion, batch.hashes),
  );
  return batch.plaintextCodes;
}

async function activeCodeCount(userId: number): Promise<number> {
  const rows = (await client!.sql`
    SELECT count(*)::int AS "count"
      FROM app.mfa_recovery_codes
     WHERE user_id = ${userId}
       AND used_at IS NULL
  `) as unknown as readonly { count: number }[];
  return rows[0]!.count;
}

async function sessionState(sessionId: number): Promise<string> {
  const rows = (await client!.sql`
    SELECT auth_state AS "authState"
      FROM app.user_sessions
     WHERE id = ${sessionId}
  `) as unknown as readonly { authState: string }[];
  return rows[0]!.authState;
}

async function lastAudit(action: string): Promise<{
  readonly actorId: number | null;
  readonly targetId: string | null;
}> {
  const rows = (await auditReader!.sql`
    SELECT actor_id AS "actorId", target_id AS "targetId"
      FROM app.audit_logs
     WHERE action = ${action}
     ORDER BY sequence_no DESC
     LIMIT 1
  `) as unknown as readonly {
    readonly actorId: number | null;
    readonly targetId: string | null;
  }[];
  return rows[0]!;
}

function cookieFor(token: string): string {
  return `__Host-session=${token}`;
}

function wrongCode(issued: readonly string[]): string {
  const candidate = "22222222222222222222";
  return issued.includes(candidate) ? "33333333333333333333" : candidate;
}

async function countMfaBuckets(): Promise<number> {
  const rows = (await client!.sql`
    SELECT count(*)::int AS "count"
      FROM app.auth_rate_limit_buckets
     WHERE bucket_type = 'MFA'
  `) as unknown as readonly { count: number }[];
  return rows[0]!.count;
}

beforeAll(async () => {
  client = createDatabaseClient(testUrls().runtime, {
    applicationName: "inpulse-mfa-recovery-integration-test",
  });
  auditReader = createDatabaseClient(testUrls().auditReader, {
    applicationName: "inpulse-mfa-recovery-audit-reader",
  });
  unitOfWork = new PostgresUnitOfWork(client);
  const hmacKeyring = VersionedHmacKeyring.fromEntries(
    [{ version: 1, key: randomBytes(32) }],
    1,
  );
  tokenService = new SessionTokenService(hmacKeyring);
  const userRepository = new PostgresUserCredentialRepository();
  const sessionRepository = new PostgresUserSessionRepository();
  const csrfRepository = new PostgresSessionCsrfTokenRepository();
  const rateRepository = new PostgresAuthRateLimitRepository();
  recoveryRepository = new PostgresMfaRecoveryCodeRepository();
  factorRepository = new PostgresUserTotpFactorRepository();
  recoveryCodeService = new RecoveryCodeService();
  const auditPort = new PostgresAuditWritePort({
    currentVersion: 1,
    keyFor: () => Buffer.alloc(32, 0x72),
  });
  recoveryService = new MfaRecoveryService(
    unitOfWork,
    userRepository,
    factorRepository,
    sessionRepository,
    csrfRepository,
    recoveryRepository,
    recoveryCodeService,
    tokenService,
    new MfaRateLimitService(unitOfWork, rateRepository, hmacKeyring),
    new AdminHighRiskAuthService(
      sessionRepository,
      csrfRepository,
      tokenService,
      userRepository,
    ),
    auditPort,
  );
});

afterAll(async () => {
  await client?.close();
  await auditReader?.close();
});

describe("管理员恢复码轮换与消费（真实 PostgreSQL）", () => {
  test("轮换消费重认证 generation、失效旧码并写入审计", async () => {
    const admin = await createAdminWithFactor();
    const session = await createSession(
      admin.userId,
      admin.authVersion,
      "AUTHENTICATED",
    );
    await refreshReauthentication(session.sessionId);
    await issueRecoveryCodes(admin.userId, 1);

    const result = await recoveryService.rotate({
      cookieHeader: cookieFor(session.sessionToken),
      csrfToken: session.csrfToken,
      requestId: randomUUID(),
    });

    expect(result.recoveryCodes).toHaveLength(10);
    expect(await activeCodeCount(admin.userId)).toBe(10);
    const audit = await lastAudit("auth.mfa_recovery_rotate");
    expect(audit.actorId).toBe(admin.userId);
    expect(audit.targetId).toBe(String(admin.userId));
  });

  test("同一 rotation generation 并发只有一个 2xx", async () => {
    const admin = await createAdminWithFactor();
    const session = await createSession(
      admin.userId,
      admin.authVersion,
      "AUTHENTICATED",
    );
    await refreshReauthentication(session.sessionId);

    const results = await Promise.allSettled([
      recoveryService.rotate({
        cookieHeader: cookieFor(session.sessionToken),
        csrfToken: session.csrfToken,
        requestId: randomUUID(),
      }),
      recoveryService.rotate({
        cookieHeader: cookieFor(session.sessionToken),
        csrfToken: session.csrfToken,
        requestId: randomUUID(),
      }),
    ]);
    const fulfilled = results.filter((item) => item.status === "fulfilled");
    const rejected = results.filter((item) => item.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      status: 409,
      code: "MFA_RECOVERY_CONFLICT",
    });
  });

  test("消费恢复码后升级 Session 并失效旧码", async () => {
    const admin = await createAdminWithFactor();
    const session = await createSession(
      admin.userId,
      admin.authVersion,
      "RECOVERY_CHALLENGE",
    );
    const codes = await issueRecoveryCodes(admin.userId, 1);

    const result = await recoveryService.consume({
      code: codes[0]!,
      clientIp: "198.51.100.50",
      cookieHeader: cookieFor(session.sessionToken),
      csrfToken: session.csrfToken,
      requestId: randomUUID(),
    });

    expect(result.authState).toBe("AUTHENTICATED");
    expect(result.csrfToken).toHaveLength(43);
    expect(await sessionState(session.sessionId)).toBe("AUTHENTICATED");
    expect(await activeCodeCount(admin.userId)).toBe(0);
    const audit = await lastAudit("auth.mfa_recovery_consume");
    expect(audit.actorId).toBe(admin.userId);
    expect(audit.targetId).toBe(String(admin.userId));
  });

  test("同一恢复码并发只消费一次", async () => {
    const admin = await createAdminWithFactor();
    const codes = await issueRecoveryCodes(admin.userId, 1);
    const first = await createSession(
      admin.userId,
      admin.authVersion,
      "RECOVERY_CHALLENGE",
    );
    const second = await createSession(
      admin.userId,
      admin.authVersion,
      "RECOVERY_CHALLENGE",
    );

    const results = await Promise.allSettled([
      recoveryService.consume({
        code: codes[0]!,
        clientIp: "198.51.100.51",
        cookieHeader: cookieFor(first.sessionToken),
        csrfToken: first.csrfToken,
        requestId: randomUUID(),
      }),
      recoveryService.consume({
        code: codes[0]!,
        clientIp: "198.51.100.52",
        cookieHeader: cookieFor(second.sessionToken),
        csrfToken: second.csrfToken,
        requestId: randomUUID(),
      }),
    ]);
    const fulfilled = results.filter((item) => item.status === "fulfilled");
    const rejected = results.filter((item) => item.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      status: 409,
      code: "MFA_RECOVERY_CONFLICT",
    });
    expect(await activeCodeCount(admin.userId)).toBe(0);
  });

  test("错误恢复码返回 401 并写入限流", async () => {
    const admin = await createAdminWithFactor();
    const session = await createSession(
      admin.userId,
      admin.authVersion,
      "RECOVERY_CHALLENGE",
    );
    const codes = await issueRecoveryCodes(admin.userId, 1);

    await expect(
      recoveryService.consume({
        code: wrongCode(codes),
        clientIp: "198.51.100.53",
        cookieHeader: cookieFor(session.sessionToken),
        csrfToken: session.csrfToken,
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({
      status: 401,
      code: "INVALID_RECOVERY_CODE",
    });
    expect(await sessionState(session.sessionId)).toBe("RECOVERY_CHALLENGE");
    expect(await countMfaBuckets()).toBeGreaterThan(0);
  });

  test("非管理员恢复码 Session 返回 403", async () => {
    const user = await createAdminWithFactor(false);
    const session = await createSession(
      user.userId,
      user.authVersion,
      "RECOVERY_CHALLENGE",
    );
    const codes = await issueRecoveryCodes(user.userId, 1);

    await expect(
      recoveryService.consume({
        code: codes[0]!,
        clientIp: "198.51.100.54",
        cookieHeader: cookieFor(session.sessionToken),
        csrfToken: session.csrfToken,
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({
      status: 403,
      code: "MFA_ADMIN_REQUIRED",
    });
  });
});
