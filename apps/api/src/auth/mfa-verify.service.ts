import { Injectable } from "@nestjs/common";

import { PostgresUnitOfWork } from "../database/unit-of-work.js";
import type { TransactionContext } from "../database/transaction-context.js";
import {
  AUTH_CSRF_MAX_AGE_SECONDS,
  SESSION_COOKIE_NAME,
  parseCookieHeader,
} from "./csrf.http.js";
import {
  csrfRejected,
  invalidMfaSession,
  invalidTotpCode,
  MfaVerifyError,
  notAdmin,
  verifyConflict,
} from "./mfa-verify.error.js";
import { MfaRateLimitService } from "./mfa-rate-limit.service.js";
import { PostgresSessionCsrfTokenRepository } from "./session-csrf-token.repository.js";
import { SessionTokenService } from "./session-token.service.js";
import {
  constantTimeEqual,
  generateOpaqueToken,
  isValidOpaqueToken,
} from "./token.js";
import { TotpService } from "./totp.service.js";
import { PostgresUserCredentialRepository } from "./user-credential.repository.js";
import type { ValidUserSession } from "./user-session.repository.js";
import { PostgresUserSessionRepository } from "./user-session.repository.js";
import { PostgresUserTotpFactorRepository } from "./user-totp-factor.repository.js";

const MFA_CHALLENGE_STATE = "MFA_CHALLENGE" as const;

export interface VerifyMfaInput {
  readonly code: string;
  readonly clientIp: string;
  readonly cookieHeader: string | undefined;
  readonly csrfToken: string | undefined;
}

export interface VerifyMfaResult {
  readonly csrfToken: string;
  readonly authState: "AUTHENTICATED";
}

/**
 * F-02.2 管理员 TOTP 验证纵切片：
 * - 只接受 `MFA_CHALLENGE` 状态；完整 Session、注册/恢复受限态返回 409；
 * - 按 user → TOTP factor → current Session 锁序条件接受未使用 time-step；
 * - 同一事务升级 Session、刷新 `last_accepted_step` 并签发新 CSRF；
 * - 错误验证码写入持久化 MFA 三层限流，达到阈值返回 429。
 */
@Injectable()
export class MfaVerifyService {
  constructor(
    private readonly unitOfWork: PostgresUnitOfWork,
    private readonly userRepository: PostgresUserCredentialRepository,
    private readonly factorRepository: PostgresUserTotpFactorRepository,
    private readonly sessionRepository: PostgresUserSessionRepository,
    private readonly csrfRepository: PostgresSessionCsrfTokenRepository,
    private readonly tokenService: SessionTokenService,
    private readonly totpService: TotpService,
    private readonly rateLimitService: MfaRateLimitService,
  ) {}

  async verify(input: VerifyMfaInput): Promise<VerifyMfaResult> {
    const issuedCsrfToken = generateOpaqueToken();
    const csrfHash = this.tokenService.hash(issuedCsrfToken);
    let attemptedUserId: number | undefined;

    try {
      return await this.unitOfWork.run(async (tx) => {
        const session = await this.findValidSession(tx, input.cookieHeader);
        if (session === undefined) {
          throw invalidMfaSession();
        }
        if (session.authState !== MFA_CHALLENGE_STATE) {
          throw verifyConflict();
        }
        if (!(await this.csrfMatches(tx, session.id, input.csrfToken))) {
          throw csrfRejected();
        }

        const snapshot = await this.userRepository.lockForMfaMutation(
          tx,
          session.userId,
          session.authVersionAtIssue,
        );
        if (snapshot === undefined) {
          throw invalidMfaSession();
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
          throw verifyConflict();
        }
        await this.rateLimitService.assertAllowed(
          tx,
          snapshot.id,
          input.clientIp,
        );
        await this.lockAndVerifySession(
          tx,
          session.id,
          input.csrfToken,
          MFA_CHALLENGE_STATE,
        );

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

        const upgraded = await this.sessionRepository.upgradeToAuthenticated(
          tx,
          session.id,
        );
        if (!upgraded) {
          throw verifyConflict();
        }
        const accepted = await this.factorRepository.acceptStep(
          tx,
          snapshot.id,
          factor.lastAcceptedStep,
          acceptedStep,
        );
        if (!accepted) {
          throw verifyConflict();
        }
        await this.csrfRepository.issue(tx, {
          sessionId: session.id,
          tokenHash: csrfHash.hash,
          expiresAt: new Date(Date.now() + AUTH_CSRF_MAX_AGE_SECONDS * 1000),
        });

        return {
          csrfToken: issuedCsrfToken,
          authState: "AUTHENTICATED",
        };
      });
    } catch (error) {
      if (
        error instanceof MfaVerifyError &&
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

  private async lockAndVerifySession(
    tx: TransactionContext,
    sessionId: number,
    csrfToken: string | undefined,
    expectedState: ValidUserSession["authState"],
  ): Promise<void> {
    const locked = await this.sessionRepository.lockById(tx, sessionId);
    if (locked === undefined) {
      throw invalidMfaSession();
    }
    if (locked.authState !== expectedState) {
      throw verifyConflict();
    }
    if (!(await this.csrfMatches(tx, sessionId, csrfToken))) {
      throw csrfRejected();
    }
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
