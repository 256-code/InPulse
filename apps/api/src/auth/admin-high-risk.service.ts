import { Injectable } from "@nestjs/common";

import type { TransactionContext } from "../database/transaction-context.js";
import {
  SESSION_COOKIE_NAME,
  getHeader,
  parseCookieHeader,
  type HttpHeaderBag,
} from "./csrf.http.js";
import {
  fullAdminSessionRequired,
  invalidAdminSession,
  notAdmin,
  reauthExpired,
  csrfRejected,
} from "./admin-high-risk.error.js";
import { PostgresSessionCsrfTokenRepository } from "./session-csrf-token.repository.js";
import { SessionTokenService } from "./session-token.service.js";
import { constantTimeEqual, isValidOpaqueToken } from "./token.js";
import { PostgresUserCredentialRepository } from "./user-credential.repository.js";
import type { ValidUserSession } from "./user-session.repository.js";
import { PostgresUserSessionRepository } from "./user-session.repository.js";

export const ADMIN_REAUTH_WINDOW_MS = 5 * 60 * 1000;

export interface AdminHighRiskActor {
  readonly userId: number;
  readonly sessionId: number;
  readonly authVersionAtIssue: number;
  readonly recoveryRotationGeneration: number;
  readonly recoveryRotationConsumedGeneration: number;
}

interface ReauthMetaRow {
  readonly reauthenticatedAt: string | null;
  readonly mfaVerifiedAt: string | null;
  readonly recoveryRotationGeneration: number;
  readonly recoveryRotationConsumedGeneration: number;
}

/**
 * 管理员高风险操作的前置校验。只负责解析与读取，不锁定 user/factor/Session；
 * MFA 状态变更调用方仍须按 user → factor → Session 锁序自行取锁，
 * 并在取锁后再次调用本方法确认新鲜度与 CSRF。
 */
@Injectable()
export class AdminHighRiskAuthService {
  constructor(
    private readonly sessionRepository: PostgresUserSessionRepository,
    private readonly csrfRepository: PostgresSessionCsrfTokenRepository,
    private readonly tokenService: SessionTokenService,
    private readonly userRepository: PostgresUserCredentialRepository,
  ) {}

  async verify(
    tx: TransactionContext,
    headers: HttpHeaderBag,
  ): Promise<AdminHighRiskActor> {
    return this.verifyFresh(tx, headers, true);
  }

  /**
   * 高风险管理操作的只读入口：仍要求完整管理员 Session 与 5 分钟内
   * 密码 + TOTP 新鲜度，但 GET 没有状态变更，不强制同步 CSRF。
   */
  async verifyRead(
    tx: TransactionContext,
    headers: HttpHeaderBag,
  ): Promise<AdminHighRiskActor> {
    return this.verifyFresh(tx, headers, false);
  }

  private async verifyFresh(
    tx: TransactionContext,
    headers: HttpHeaderBag,
    requireCsrf: boolean,
  ): Promise<AdminHighRiskActor> {
    const session = await this.findUnlockedSession(
      tx,
      getHeader(headers, "cookie"),
    );
    if (session === undefined) {
      throw invalidAdminSession();
    }
    if (session.authState !== "AUTHENTICATED") {
      throw fullAdminSessionRequired();
    }
    if (
      requireCsrf &&
      !(await this.csrfMatches(
        tx,
        session.id,
        getHeader(headers, "x-csrf-token"),
      ))
    ) {
      throw csrfRejected();
    }

    const user = await this.userRepository.findById(tx, session.userId);
    if (user === undefined || !user.isAdmin) {
      throw notAdmin();
    }

    const rows = (await tx.sql`
      SELECT us.reauthenticated_at::text AS "reauthenticatedAt",
             us.mfa_verified_at::text AS "mfaVerifiedAt",
             us.recovery_rotation_generation AS "recoveryRotationGeneration",
             us.recovery_rotation_consumed_generation AS "recoveryRotationConsumedGeneration"
        FROM app.user_sessions AS us
        JOIN app.users AS u ON u.id = us.user_id
       WHERE us.id = ${session.id}
         AND us.revoked_at IS NULL
         AND us.auth_state = 'AUTHENTICATED'
         AND u.is_admin = true
         AND u.status = 'ACTIVE'
         AND u.disabled_at IS NULL
         AND u.auth_version = us.auth_version_at_issue
         AND us.idle_expires_at > now()
         AND us.absolute_expires_at > now()
       LIMIT 1
    `) as unknown as readonly ReauthMetaRow[];
    const meta = rows[0];
    if (meta === undefined || !this.isFresh(meta)) {
      throw reauthExpired();
    }
    return {
      userId: session.userId,
      sessionId: session.id,
      authVersionAtIssue: session.authVersionAtIssue,
      recoveryRotationGeneration: meta.recoveryRotationGeneration,
      recoveryRotationConsumedGeneration:
        meta.recoveryRotationConsumedGeneration,
    };
  }

  private async findUnlockedSession(
    tx: TransactionContext,
    cookieHeader: string | undefined,
  ): Promise<ValidUserSession | undefined> {
    const sessionToken = parseCookieHeader(cookieHeader, SESSION_COOKIE_NAME);
    if (sessionToken === undefined) {
      return undefined;
    }
    const candidates = this.tokenService.hashCandidates(sessionToken);
    if (candidates.length === 0) {
      return undefined;
    }
    return this.sessionRepository.findValidUnlockedByTokenHashes(
      tx,
      candidates.map((candidate) => candidate.hash),
    );
  }

  private async csrfMatches(
    tx: TransactionContext,
    sessionId: number,
    csrfToken: string | undefined,
  ): Promise<boolean> {
    if (csrfToken === undefined || !isValidOpaqueToken(csrfToken)) {
      return false;
    }
    const candidate = this.tokenService.hash(csrfToken).hash;
    const hashes = await this.csrfRepository.findValidHashes(tx, sessionId);
    return hashes.some((hash) => constantTimeEqual(hash, candidate));
  }

  private isFresh(meta: ReauthMetaRow): boolean {
    const now = Date.now();
    const reauthenticatedAt =
      meta.reauthenticatedAt === null
        ? Number.NaN
        : Date.parse(meta.reauthenticatedAt);
    const mfaVerifiedAt =
      meta.mfaVerifiedAt === null ? Number.NaN : Date.parse(meta.mfaVerifiedAt);
    return (
      Number.isFinite(reauthenticatedAt) &&
      Number.isFinite(mfaVerifiedAt) &&
      now - reauthenticatedAt <= ADMIN_REAUTH_WINDOW_MS &&
      now - mfaVerifiedAt <= ADMIN_REAUTH_WINDOW_MS
    );
  }
}
