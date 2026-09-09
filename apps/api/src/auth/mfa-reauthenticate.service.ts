import { Injectable } from "@nestjs/common";

import { PostgresUnitOfWork } from "../database/unit-of-work.js";
import type { TransactionContext } from "../database/transaction-context.js";
import { LoginRateLimitService } from "./auth-rate-limit.service.js";
import { SESSION_COOKIE_NAME, parseCookieHeader } from "./csrf.http.js";
import {
  csrfRejected,
  fullSessionRequired,
  invalidPassword,
  invalidSession,
  invalidTotpCode,
  MfaReauthenticateError,
  notAdmin,
  reauthConflict,
} from "./mfa-reauthenticate.error.js";
import { MfaRateLimitService } from "./mfa-rate-limit.service.js";
import { PostgresSessionCsrfTokenRepository } from "./session-csrf-token.repository.js";
import { SessionTokenService } from "./session-token.service.js";
import { constantTimeEqual, isValidOpaqueToken } from "./token.js";
import { PasswordService } from "./password.service.js";
import { TotpService } from "./totp.service.js";
import { PostgresUserCredentialRepository } from "./user-credential.repository.js";
import type { UserCredential } from "./user-credential.repository.js";
import type { ValidUserSession } from "./user-session.repository.js";
import { PostgresUserSessionRepository } from "./user-session.repository.js";
import { PostgresUserTotpFactorRepository } from "./user-totp-factor.repository.js";

const AUTHENTICATED_STATE = "AUTHENTICATED" as const;

export interface ReauthenticateAdminInput {
  readonly password: string;
  readonly code: string;
  readonly clientIp: string;
  readonly cookieHeader: string | undefined;
  readonly csrfToken: string | undefined;
}

interface PreparedReauth {
  readonly session: ValidUserSession;
  readonly user: UserCredential;
}

/**
 * F-02.3 管理员重认证纵切片：
 * - 只接受完整 `AUTHENTICATED` 管理员 Session；
 * - 密码 Argon2id 校验在事务外执行，避免长 CPU 工作持锁；
 * - 密码通过后按 user → factor → Session 锁序验证未使用当前 TOTP time-step；
 * - 成功时在同一服务端事务时间刷新 `reauthenticated_at`、`mfa_verified_at`
 *   并递增一次性 `recovery_rotation_generation`。
 */
@Injectable()
export class MfaReauthenticateService {
  constructor(
    private readonly unitOfWork: PostgresUnitOfWork,
    private readonly userRepository: PostgresUserCredentialRepository,
    private readonly factorRepository: PostgresUserTotpFactorRepository,
    private readonly sessionRepository: PostgresUserSessionRepository,
    private readonly csrfRepository: PostgresSessionCsrfTokenRepository,
    private readonly tokenService: SessionTokenService,
    private readonly passwordService: PasswordService,
    private readonly totpService: TotpService,
    private readonly loginRateLimitService: LoginRateLimitService,
    private readonly rateLimitService: MfaRateLimitService,
  ) {}

  async reauthenticate(input: ReauthenticateAdminInput): Promise<void> {
    const prepared = await this.prepare(input);
    const passwordValid = await this.passwordService.verify(
      input.password,
      prepared.user.passwordHash,
    );
    if (!passwordValid) {
      await this.loginRateLimitService.recordFailure(
        prepared.user.loginName,
        input.clientIp,
      );
      throw invalidPassword();
    }

    let attemptedUserId: number | undefined;
    try {
      await this.unitOfWork.run(async (tx) => {
        const snapshot = await this.userRepository.lockForMfaMutation(
          tx,
          prepared.session.userId,
          prepared.session.authVersionAtIssue,
        );
        if (snapshot === undefined) {
          throw invalidSession();
        }
        attemptedUserId = snapshot.id;
        if (!snapshot.isAdmin) {
          throw notAdmin();
        }

        const factor = await this.factorRepository.findForUpdate(
          tx,
          snapshot.id,
        );
        if (factor === undefined || factor.status !== "ACTIVE") {
          throw reauthConflict();
        }
        await this.loginRateLimitService.assertAllowed(
          tx,
          prepared.user.loginName,
          input.clientIp,
        );
        await this.rateLimitService.assertAllowed(
          tx,
          snapshot.id,
          input.clientIp,
        );

        const locked = await this.sessionRepository.lockById(
          tx,
          prepared.session.id,
        );
        if (locked === undefined) {
          throw invalidSession();
        }
        if (locked.authState !== AUTHENTICATED_STATE) {
          throw fullSessionRequired();
        }
        if (!(await this.csrfMatches(tx, locked.id, input.csrfToken))) {
          throw csrfRejected();
        }

        const secret = this.totpService.decryptSecret(factor);
        const acceptedStep = this.totpService.verifyCode(
          secret,
          input.code,
          Date.now(),
          factor.lastAcceptedStep,
        );
        if (acceptedStep === undefined) {
          throw invalidTotpCode();
        }

        const refreshed = await this.sessionRepository.refreshReauthentication(
          tx,
          locked.id,
        );
        if (!refreshed) {
          throw reauthConflict();
        }
        const accepted = await this.factorRepository.acceptStep(
          tx,
          snapshot.id,
          factor.lastAcceptedStep,
          acceptedStep,
        );
        if (!accepted) {
          throw reauthConflict();
        }
      });
    } catch (error) {
      if (
        error instanceof MfaReauthenticateError &&
        error.reason === "invalid-totp-code" &&
        attemptedUserId !== undefined
      ) {
        await this.rateLimitService.recordFailure(
          attemptedUserId,
          input.clientIp,
        );
      }
      throw error;
    }
  }

  private async prepare(
    input: ReauthenticateAdminInput,
  ): Promise<PreparedReauth> {
    return this.unitOfWork.run(async (tx) => {
      const session = await this.findValidSession(tx, input.cookieHeader);
      if (session === undefined) {
        throw invalidSession();
      }
      if (session.authState !== AUTHENTICATED_STATE) {
        throw fullSessionRequired();
      }
      if (!(await this.csrfMatches(tx, session.id, input.csrfToken))) {
        throw csrfRejected();
      }

      const user = await this.userRepository.findById(tx, session.userId);
      if (
        user === undefined ||
        user.status !== "ACTIVE" ||
        user.disabledAt !== null
      ) {
        throw invalidSession();
      }
      if (!user.isAdmin) {
        throw notAdmin();
      }
      await this.loginRateLimitService.assertAllowed(
        tx,
        user.loginName,
        input.clientIp,
      );
      await this.rateLimitService.assertAllowed(tx, user.id, input.clientIp);
      return { session, user };
    });
  }

  private async findValidSession(
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
}
