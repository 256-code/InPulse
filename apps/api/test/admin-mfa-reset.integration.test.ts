import { randomBytes, randomUUID } from "node:crypto";

import {
  createDatabaseClient,
  type DatabaseClient,
} from "@inpulse/database/client";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { PostgresAuditWritePort } from "../src/audit/postgres-audit-write-port.js";
import { AdminHighRiskAuthService } from "../src/auth/admin-high-risk.service.js";
import { AdminMfaResetService } from "../src/auth/admin-mfa-reset.service.js";
import { VersionedHmacKeyring } from "../src/auth/keyring.js";
import { PostgresMfaRecoveryCodeRepository } from "../src/auth/mfa-recovery-code.repository.js";
import { PostgresSessionCsrfTokenRepository } from "../src/auth/session-csrf-token.repository.js";
import { SessionTokenService } from "../src/auth/session-token.service.js";
import { generateOpaqueToken } from "../src/auth/token.js";
import { PostgresUserCredentialRepository } from "../src/auth/user-credential.repository.js";
import { PostgresUserSessionRepository } from "../src/auth/user-session.repository.js";
import { PostgresUserTotpFactorRepository } from "../src/auth/user-totp-factor.repository.js";
import { UserAuthInvalidationService } from "../src/auth/user-auth-invalidation.service.js";
import { PostgresUnitOfWork } from "../src/database/unit-of-work.js";
import { createUser, testUrls } from "./database.helpers.js";

let client: DatabaseClient | undefined;
let auditReader: DatabaseClient | undefined;
let unitOfWork: PostgresUnitOfWork;
let tokenService: SessionTokenService;
let userRepository: PostgresUserCredentialRepository;
let sessionRepository: PostgresUserSessionRepository;
let factorRepository: PostgresUserTotpFactorRepository;
let recoveryRepository: PostgresMfaRecoveryCodeRepository;
let resetService: AdminMfaResetService;

async function authVersionFor(userId: number): Promise<number> {
  const rows = (await client!.sql`
    SELECT auth_version AS "authVersion"
      FROM app.users
     WHERE id = ${userId}
  `) as unknown as readonly { authVersion: number }[];
  return rows[0]!.authVersion;
}

async function seedAdmin(
  options: { readonly admin?: boolean; readonly activeFactor?: boolean } = {},
): Promise<{ readonly userId: number; readonly authVersion: number }> {
  const userId = await createUser(client!.sql, {
    admin: options.admin !== false,
  });
  const authVersion = await authVersionFor(userId);
  if (options.activeFactor !== false) {
    await unitOfWork.run(async (tx) => {
      await factorRepository.insertPending(tx, userId, 1, {
        keyVersion: 1,
        nonce: Buffer.alloc(12),
        ciphertext: Buffer.from("test"),
        authTag: Buffer.alloc(16),
      });
      await factorRepository.activate(tx, userId, 1, 0);
    });
  }
  return { userId, authVersion };
}

async function createSession(
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
    const session = await sessionRepository.create(tx, {
      userId,
      tokenHash: sessionHash.hash,
      tokenHashKeyVersion: sessionHash.keyVersion,
      authVersionAtIssue: authVersion,
      authState: "AUTHENTICATED",
      idleExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      absoluteExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    await new PostgresSessionCsrfTokenRepository().issue(tx, {
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
    sessionRepository.refreshReauthentication(tx, sessionId),
  );
}

async function seedRecoveryCode(userId: number): Promise<void> {
  await unitOfWork.run((tx) =>
    recoveryRepository.issueBatch(tx, userId, 1, [
      { codeHash: "$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture-hash" },
    ]),
  );
}

async function targetState(userId: number): Promise<{
  readonly status: string;
  readonly disabledAt: string | null;
  readonly authVersion: number;
  readonly activeSessions: number;
  readonly activeCodes: number;
}> {
  const rows = (await client!.sql`
    SELECT u.auth_version AS "authVersion",
           f.status AS "status",
           f.disabled_at::text AS "disabledAt",
           (SELECT count(*)::int FROM app.user_sessions us
             WHERE us.user_id = u.id AND us.revoked_at IS NULL) AS "activeSessions",
           (SELECT count(*)::int FROM app.mfa_recovery_codes c
             WHERE c.user_id = u.id AND c.used_at IS NULL) AS "activeCodes"
      FROM app.users AS u
      LEFT JOIN app.user_totp_factors AS f ON f.user_id = u.id
     WHERE u.id = ${userId}
  `) as unknown as readonly {
    readonly status: string;
    readonly disabledAt: string | null;
    readonly authVersion: number;
    readonly activeSessions: number;
    readonly activeCodes: number;
  }[];
  return rows[0]!;
}

async function lastResetAudit(userId: number): Promise<{
  readonly actorId: number | null;
  readonly targetId: string | null;
  readonly reason: string | null;
}> {
  const rows = (await auditReader!.sql`
    SELECT actor_id AS "actorId",
           target_id AS "targetId",
           event_payload ->> 'reason' AS "reason"
      FROM app.audit_logs
     WHERE action = 'admin.mfa.reset'
       AND target_id = ${String(userId)}
     ORDER BY sequence_no DESC
     LIMIT 1
  `) as unknown as readonly {
    readonly actorId: number | null;
    readonly targetId: string | null;
    readonly reason: string | null;
  }[];
  return rows[0]!;
}

function cookieFor(token: string): string {
  return `__Host-session=${token}`;
}

async function executeReset(
  actorId: number,
  targetId: number,
  session: { readonly sessionToken: string; readonly csrfToken: string },
): Promise<void> {
  await unitOfWork.run((tx) =>
    resetService.execute(tx, actorId, {
      userId: targetId,
      reason: "集成测试在线重置",
      requestId: randomUUID(),
      headers: {
        cookie: cookieFor(session.sessionToken),
        "x-csrf-token": session.csrfToken,
      },
      ipAddress: "198.51.100.60",
    }),
  );
}

beforeAll(async () => {
  client = createDatabaseClient(testUrls().runtime, {
    applicationName: "inpulse-admin-mfa-reset-integration-test",
  });
  auditReader = createDatabaseClient(testUrls().auditReader, {
    applicationName: "inpulse-admin-mfa-reset-audit-reader",
  });
  unitOfWork = new PostgresUnitOfWork(client);
  const hmacKeyring = VersionedHmacKeyring.fromEntries(
    [{ version: 1, key: randomBytes(32) }],
    1,
  );
  tokenService = new SessionTokenService(hmacKeyring);
  userRepository = new PostgresUserCredentialRepository();
  sessionRepository = new PostgresUserSessionRepository();
  factorRepository = new PostgresUserTotpFactorRepository();
  recoveryRepository = new PostgresMfaRecoveryCodeRepository();
  const csrfRepository = new PostgresSessionCsrfTokenRepository();
  const auditPort = new PostgresAuditWritePort({
    currentVersion: 1,
    keyFor: () => Buffer.alloc(32, 0x73),
  });
  resetService = new AdminMfaResetService(
    userRepository,
    factorRepository,
    recoveryRepository,
    sessionRepository,
    new AdminHighRiskAuthService(
      sessionRepository,
      csrfRepository,
      tokenService,
      userRepository,
    ),
    new UserAuthInvalidationService(
      unitOfWork,
      userRepository,
      sessionRepository,
    ),
    auditPort,
  );
});

afterAll(async () => {
  await client?.close();
  await auditReader?.close();
});

describe("管理员 MFA 重置（真实 PostgreSQL）", () => {
  test("成功后禁用目标因子、失效恢复码、撤销 Session 并写审计", async () => {
    const actor = await seedAdmin();
    const target = await seedAdmin();
    await seedRecoveryCode(target.userId);
    const actorSession = await createSession(actor.userId, actor.authVersion);
    const targetSession = await createSession(
      target.userId,
      target.authVersion,
    );
    await refreshReauthentication(actorSession.sessionId);
    const beforeAuthVersion = await authVersionFor(target.userId);

    await executeReset(actor.userId, target.userId, actorSession);

    const state = await targetState(target.userId);
    expect(state.status).toBe("DISABLED");
    expect(state.disabledAt).not.toBeNull();
    expect(state.authVersion).toBe(beforeAuthVersion + 1);
    expect(state.activeSessions).toBe(0);
    expect(state.activeCodes).toBe(0);
    const audit = await lastResetAudit(target.userId);
    expect(audit.actorId).toBe(actor.userId);
    expect(audit.targetId).toBe(String(target.userId));
    expect(audit.reason).toBe("集成测试在线重置");
    const actorSessionRow = (await client!.sql`
      SELECT revoked_at IS NULL AS "active"
        FROM app.user_sessions
       WHERE id = ${actorSession.sessionId}
    `) as unknown as readonly { active: boolean }[];
    expect(actorSessionRow[0]!.active).toBe(true);
    const targetSessionRow = (await client!.sql`
      SELECT revoked_at IS NULL AS "active"
        FROM app.user_sessions
       WHERE id = ${targetSession.sessionId}
    `) as unknown as readonly { active: boolean }[];
    expect(targetSessionRow[0]!.active).toBe(false);
  });

  test("不能重置自己", async () => {
    const actor = await seedAdmin();
    const session = await createSession(actor.userId, actor.authVersion);
    await refreshReauthentication(session.sessionId);

    await expect(
      executeReset(actor.userId, actor.userId, session),
    ).rejects.toMatchObject({
      status: 409,
      code: "ADMIN_MFA_SELF_RESET_REJECTED",
    });
    expect((await targetState(actor.userId)).status).toBe("ACTIVE");
  });

  test("目标不是管理员返回 403", async () => {
    const actor = await seedAdmin();
    const other = await seedAdmin();
    const target = await seedAdmin({ admin: false });
    const session = await createSession(actor.userId, actor.authVersion);
    await refreshReauthentication(session.sessionId);
    await seedRecoveryCode(target.userId);

    await expect(
      executeReset(actor.userId, target.userId, session),
    ).rejects.toMatchObject({
      status: 403,
      code: "ADMIN_REQUIRED",
    });
    expect((await targetState(target.userId)).status).toBe("ACTIVE");
    expect(await authVersionFor(other.userId)).toBe(other.authVersion);
  });

  test("仅剩一名可用 MFA 管理员时拒绝在线重置", async () => {
    await client!.sql`
      UPDATE app.users
         SET status = 'DISABLED',
             disabled_at = now(),
             row_version = row_version + 1
       WHERE is_admin = true
         AND status = 'ACTIVE'
    `;
    const actor = await seedAdmin({ activeFactor: false });
    const target = await seedAdmin();
    const session = await createSession(actor.userId, actor.authVersion);
    await refreshReauthentication(session.sessionId);

    await expect(
      executeReset(actor.userId, target.userId, session),
    ).rejects.toMatchObject({
      status: 409,
      code: "LAST_MFA_ADMIN_REQUIRES_OFFLINE_RECOVERY",
    });
    expect((await targetState(target.userId)).status).toBe("ACTIVE");
  });

  test("缺少 5 分钟重认证时拒绝且不修改目标", async () => {
    const actor = await seedAdmin();
    const target = await seedAdmin();
    const session = await createSession(actor.userId, actor.authVersion);

    await expect(
      executeReset(actor.userId, target.userId, session),
    ).rejects.toMatchObject({
      status: 403,
      code: "ADMIN_REAUTH_REQUIRED",
    });
    expect((await targetState(target.userId)).status).toBe("ACTIVE");
  });

  test("两个管理员互相重置时只有一个成功且至少保留一名 MFA 管理员", async () => {
    const first = await seedAdmin();
    const second = await seedAdmin();
    const firstSession = await createSession(first.userId, first.authVersion);
    const secondSession = await createSession(
      second.userId,
      second.authVersion,
    );
    await refreshReauthentication(firstSession.sessionId);
    await refreshReauthentication(secondSession.sessionId);

    const results = await Promise.allSettled([
      executeReset(first.userId, second.userId, firstSession),
      executeReset(second.userId, first.userId, secondSession),
    ]);
    const fulfilled = results.filter((item) => item.status === "fulfilled");
    const rejected = results.filter((item) => item.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect([401, 403, 409]).toContain(
      (rejected[0] as PromiseRejectedResult).reason.status,
    );
    const firstState = await targetState(first.userId);
    const secondState = await targetState(second.userId);
    const remaining =
      (firstState.status === "ACTIVE" ? 1 : 0) +
      (secondState.status === "ACTIVE" ? 1 : 0);
    expect(remaining).toBe(1);
  });
});
