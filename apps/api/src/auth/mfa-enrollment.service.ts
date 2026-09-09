import { Injectable } from "@nestjs/common";

import { PostgresUnitOfWork } from "../database/unit-of-work.js";
import type { TransactionContext } from "../database/transaction-context.js";
import {
  AUTH_CSRF_MAX_AGE_SECONDS,
  PREAUTH_COOKIE_NAME,
  SESSION_ABSOLUTE_MAX_AGE_SECONDS,
  SESSION_COOKIE_NAME,
  SESSION_IDLE_MAX_AGE_SECONDS,
  type CsrfSetCookie,
  parseCookieHeader,
} from "./csrf.http.js";
import {
  csrfRejected,
  enrollmentConflict,
  invalidSession,
  invalidTotpCode,
  MfaEnrollmentError,
  notAdmin,
} from "./mfa-enrollment.error.js";
import { PostgresMfaRecoveryCodeRepository } from "./mfa-recovery-code.repository.js";
import { RecoveryCodeService } from "./recovery-code.service.js";
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

const MFA_ENROLLMENT_STATE = "MFA_ENROLLMENT" as const;

export interface StartMfaEnrollmentInput {
  readonly expectedEnrollmentGeneration: number;
  readonly cookieHeader: string | undefined;
  readonly csrfToken: string | undefined;
}

export interface StartMfaEnrollmentResult {
  readonly enrollmentGeneration: number;
  readonly secret: string;
  readonly otpauthUri: string;
}

export interface ConfirmMfaEnrollmentInput {
  readonly expectedEnrollmentGeneration: number;
  readonly code: string;
  readonly clientIp: string;
  readonly cookieHeader: string | undefined;
  readonly csrfToken: string | undefined;
}

export interface ConfirmMfaEnrollmentResult {
  readonly csrfToken: string;
  readonly authState: "AUTHENTICATED";
  readonly recoveryCodes: readonly string[];
  readonly cookies: readonly CsrfSetCookie[];
}

/**
 * F-02.1 管理员 MFA 注册纵切片：
 * - start 按 user → factor → current Session 锁序创建 pending 密文；
 * - confirm 验证 pending Secret 的当前 TOTP，条件激活因子、签发恢复码哈希、
 *   撤销受限 Session，并在同一事务轮换为完整 AUTHENTICATED Session/CSRF；
 * - 恢复码 Argon2id 哈希和明文响应分离，明文不落库、不写日志。
 */
@Injectable()
export class MfaEnrollmentService {
  constructor(
    private readonly unitOfWork: PostgresUnitOfWork,
    private readonly userRepository: PostgresUserCredentialRepository,
    private readonly factorRepository: PostgresUserTotpFactorRepository,
    private readonly sessionRepository: PostgresUserSessionRepository,
    private readonly csrfRepository: PostgresSessionCsrfTokenRepository,
    private readonly recoveryCodeRepository: PostgresMfaRecoveryCodeRepository,
    private readonly tokenService: SessionTokenService,
    private readonly totpService: TotpService,
    private readonly recoveryCodeService: RecoveryCodeService,
    private readonly rateLimitService: MfaRateLimitService,
  ) {}

  async start(
    input: StartMfaEnrollmentInput,
  ): Promise<StartMfaEnrollmentResult> {
    const secret = this.totpService.generateSecretBase32();
    const encrypted = this.totpService.encryptSecret(secret);
    return this.unitOfWork.run(async (tx) => {
      const session = await this.resolveEnrollmentSession(
        tx,
        input.cookieHeader,
        input.csrfToken,
      );
      if (session === undefined) {
        throw invalidSession();
      }
      const snapshot = await this.userRepository.lockForMfaMutation(
        tx,
        session.userId,
        session.authVersionAtIssue,
      );
      if (snapshot === undefined) {
        throw invalidSession();
      }
      if (!snapshot.isAdmin) {
        throw notAdmin();
      }

      const factor = await this.factorRepository.findForUpdate(tx, snapshot.id);
      const currentGeneration = factor?.enrollmentGeneration ?? 0;
      if (
        input.expectedEnrollmentGeneration !== currentGeneration ||
        (factor !== undefined && factor.status === "ACTIVE")
      ) {
        throw enrollmentConflict();
      }
      await this.lockAndVerifySession(
        tx,
        session.id,
        input.csrfToken,
        MFA_ENROLLMENT_STATE,
      );

      const generation = currentGeneration + 1;
      if (factor === undefined) {
        await this.factorRepository.insertPending(
          tx,
          snapshot.id,
          generation,
          encrypted,
        );
      } else {
        const replaced = await this.factorRepository.replacePending(
          tx,
          snapshot.id,
          currentGeneration,
          generation,
          encrypted,
        );
        if (!replaced) {
          throw enrollmentConflict();
        }
      }
      return {
        enrollmentGeneration: generation,
        secret,
        otpauthUri: this.totpService.buildOtpauthUri(secret, snapshot.id),
      };
    });
  }

  async confirm(
    input: ConfirmMfaEnrollmentInput,
  ): Promise<ConfirmMfaEnrollmentResult> {
    const rateLimitUserId = await this.unitOfWork.run(async (tx) => {
      const session = await this.resolveEnrollmentSession(
        tx,
        input.cookieHeader,
        input.csrfToken,
      );
      if (session === undefined) {
        throw invalidSession();
      }
      const snapshot = await this.userRepository.lockForSessionIssue(
        tx,
        session.userId,
        session.authVersionAtIssue,
      );
      if (snapshot === undefined) {
        throw invalidSession();
      }
      if (!snapshot.isAdmin) {
        throw notAdmin();
      }
      await this.rateLimitService.assertAllowed(
        tx,
        snapshot.id,
        input.clientIp,
      );
      return snapshot.id;
    });
    const recovery = await this.recoveryCodeService.issueBatch();
    const issuedSessionToken = generateOpaqueToken();
    const issuedCsrfToken = generateOpaqueToken();
    const sessionHash = this.tokenService.hash(issuedSessionToken);
    const csrfHash = this.tokenService.hash(issuedCsrfToken);
    let attemptedUserId = rateLimitUserId;
    try {
      return await this.unitOfWork.run(async (tx) => {
        const session = await this.resolveEnrollmentSession(
          tx,
          input.cookieHeader,
          input.csrfToken,
        );
        if (session === undefined) {
          throw invalidSession();
        }
        const snapshot = await this.userRepository.lockForMfaMutation(
          tx,
          session.userId,
          session.authVersionAtIssue,
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
        if (
          factor === undefined ||
          factor.status !== "ENROLLING" ||
          factor.enrollmentGeneration !== input.expectedEnrollmentGeneration
        ) {
          throw enrollmentConflict();
        }
        await this.rateLimitService.assertAllowed(
          tx,
          snapshot.id,
          input.clientIp,
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
        await this.lockAndVerifySession(
          tx,
          session.id,
          input.csrfToken,
          MFA_ENROLLMENT_STATE,
        );
        const activated = await this.factorRepository.activate(
          tx,
          snapshot.id,
          input.expectedEnrollmentGeneration,
          acceptedStep,
        );
        if (!activated) {
          throw enrollmentConflict();
        }

        const batchVersion = await this.recoveryCodeRepository.nextBatchVersion(
          tx,
          snapshot.id,
        );
        await this.recoveryCodeRepository.issueBatch(
          tx,
          snapshot.id,
          batchVersion,
          recovery.hashes,
        );
        await this.sessionRepository.revoke(tx, session.id);
        const now = Date.now();
        const created = await this.sessionRepository.create(tx, {
          userId: snapshot.id,
          tokenHash: sessionHash.hash,
          tokenHashKeyVersion: sessionHash.keyVersion,
          authVersionAtIssue: snapshot.authVersion,
          authState: "AUTHENTICATED",
          idleExpiresAt: new Date(now + SESSION_IDLE_MAX_AGE_SECONDS * 1000),
          absoluteExpiresAt: new Date(
            now + SESSION_ABSOLUTE_MAX_AGE_SECONDS * 1000,
          ),
        });
        await this.csrfRepository.issue(tx, {
          sessionId: created.id,
          tokenHash: csrfHash.hash,
          expiresAt: new Date(
            Math.min(
              now + AUTH_CSRF_MAX_AGE_SECONDS * 1000,
              now + SESSION_ABSOLUTE_MAX_AGE_SECONDS * 1000,
            ),
          ),
        });

        return {
          csrfToken: issuedCsrfToken,
          authState: "AUTHENTICATED",
          recoveryCodes: recovery.plaintextCodes,
          cookies: [
            { name: PREAUTH_COOKIE_NAME, value: null, maxAgeSeconds: 0 },
            {
              name: SESSION_COOKIE_NAME,
              value: issuedSessionToken,
              maxAgeSeconds: SESSION_ABSOLUTE_MAX_AGE_SECONDS,
            },
          ],
        };
      });
    } catch (error) {
      if (
        error instanceof MfaEnrollmentError &&
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

  private async resolveEnrollmentSession(
    tx: TransactionContext,
    cookieHeader: string | undefined,
    csrfToken: string | undefined,
  ): Promise<ValidUserSession | undefined> {
    const sessionToken = parseCookieHeader(cookieHeader, SESSION_COOKIE_NAME);
    if (sessionToken === undefined) {
      return undefined;
    }
    const candidates = this.tokenService.hashCandidates(sessionToken);
    if (candidates.length === 0) {
      return undefined;
    }
    const session = await this.sessionRepository.findValidUnlockedByTokenHashes(
      tx,
      candidates.map((candidate) => candidate.hash),
    );
    if (session === undefined || session.authState !== MFA_ENROLLMENT_STATE) {
      return undefined;
    }
    return (await this.csrfMatches(tx, session.id, csrfToken))
      ? session
      : undefined;
  }

  private async lockAndVerifySession(
    tx: TransactionContext,
    sessionId: number,
    csrfToken: string | undefined,
    expectedState: ValidUserSession["authState"],
  ): Promise<void> {
    const locked = await this.sessionRepository.lockById(tx, sessionId);
    if (
      locked === undefined ||
      locked.authState !== expectedState ||
      !(await this.csrfMatches(tx, sessionId, csrfToken))
    ) {
      if (locked === undefined) {
        throw invalidSession();
      }
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

export function isMfaEnrollmentError(
  error: unknown,
): error is MfaEnrollmentError {
  return error instanceof MfaEnrollmentError;
}
