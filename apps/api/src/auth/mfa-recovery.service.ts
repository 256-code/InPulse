import { Inject, Injectable } from "@nestjs/common";

import { AuditWritePort } from "../audit/audit.port.js";
import type { TransactionContext } from "../database/transaction-context.js";
import { PostgresUnitOfWork } from "../database/unit-of-work.js";
import { AdminHighRiskAuthService } from "./admin-high-risk.service.js";
import {
  SESSION_COOKIE_NAME,
  parseCookieHeader,
  type HttpHeaderBag,
} from "./csrf.http.js";
import {
  csrfRejected,
  invalidRecoveryCode,
  invalidRecoverySession,
  notAdmin,
  recoveryConflict,
} from "./mfa-recovery.error.js";
import { MfaRateLimitService } from "./mfa-rate-limit.service.js";
import { PostgresMfaRecoveryCodeRepository } from "./mfa-recovery-code.repository.js";
import { RecoveryCodeService } from "./recovery-code.service.js";
import { PostgresSessionCsrfTokenRepository } from "./session-csrf-token.repository.js";
import { SessionTokenService } from "./session-token.service.js";
import {
  constantTimeEqual,
  generateOpaqueToken,
  isValidOpaqueToken,
} from "./token.js";
import { PostgresUserCredentialRepository } from "./user-credential.repository.js";
import type { ValidUserSession } from "./user-session.repository.js";
import { PostgresUserSessionRepository } from "./user-session.repository.js";
import { PostgresUserTotpFactorRepository } from "./user-totp-factor.repository.js";

const RECOVERY_CHALLENGE_STATE = "RECOVERY_CHALLENGE" as const;

export interface RotateMfaRecoveryCodesInput {
  readonly cookieHeader: string | undefined;
  readonly csrfToken: string | undefined;
  readonly requestId: string;
}

export interface RotateMfaRecoveryCodesResult {
  readonly recoveryCodes: readonly string[];
}

export interface ConsumeMfaRecoveryCodeInput {
  readonly code: string;
  readonly clientIp: string;
  readonly cookieHeader: string | undefined;
  readonly csrfToken: string | undefined;
  readonly requestId: string;
}

export interface ConsumeMfaRecoveryCodeResult {
  readonly csrfToken: string;
  readonly authState: "AUTHENTICATED";
}

interface PreparedRecoveryChallenge {
  readonly session: ValidUserSession;
  readonly userId: number;
}

/**
 * ADR-023 恢复码轮换与消费：
 * - 轮换只接受最近 5 分钟内完成重认证的完整管理员 Session；在事务外生成
 *   新码，事务内按 user → factor → Session 锁序条件消费 rotation generation，
 *   原子失效旧 Hash 后签发新批次，同一 generation 竞争者返回 409；
 * - 消费只接受管理员密码阶段签发的 RECOVERY_CHALLENGE；Argon2id 校验在事务
 *   外执行，事务内按相同锁序条件写 used_at、失效旧码并升级完整 Session；
 * - 恢复码明文只出现在单次 no-store 响应，数据库、日志与审计不保存明文。
 */
@Injectable()
export class MfaRecoveryService {
  constructor(
    private readonly unitOfWork: PostgresUnitOfWork,
    private readonly userRepository: PostgresUserCredentialRepository,
    private readonly factorRepository: PostgresUserTotpFactorRepository,
    private readonly sessionRepository: PostgresUserSessionRepository,
    private readonly csrfRepository: PostgresSessionCsrfTokenRepository,
    private readonly recoveryCodeRepository: PostgresMfaRecoveryCodeRepository,
    private readonly recoveryCodeService: RecoveryCodeService,
    private readonly tokenService: SessionTokenService,
    private readonly rateLimitService: MfaRateLimitService,
    private readonly adminHighRisk: AdminHighRiskAuthService,
    @Inject(AuditWritePort) private readonly audit: AuditWritePort,
  ) {}

  async rotate(
    input: RotateMfaRecoveryCodesInput,
  ): Promise<RotateMfaRecoveryCodesResult> {
    const headers = this.headers(input);
    const actor = await this.unitOfWork.run((tx) =>
      this.adminHighRisk.verify(tx, headers),
    );
    const issued = await this.recoveryCodeService.issueBatch();

    return this.unitOfWork.run(async (tx) => {
      const lockedActor = await this.adminHighRisk.verify(tx, headers);
      if (lockedActor.sessionId !== actor.sessionId) {
        throw invalidRecoverySession();
      }
      const snapshot = await this.userRepository.lockForMfaMutation(
        tx,
        actor.userId,
        actor.authVersionAtIssue,
      );
      if (snapshot === undefined || !snapshot.isAdmin) {
        throw invalidRecoverySession();
      }
      const factor = await this.factorRepository.findForUpdate(tx, snapshot.id);
      if (factor === undefined || factor.status !== "ACTIVE") {
        throw recoveryConflict();
      }
      const session = await this.sessionRepository.lockByIdWithRotation(
        tx,
        actor.sessionId,
      );
      if (
        session === undefined ||
        session.authState !== "AUTHENTICATED" ||
        session.userId !== actor.userId
      ) {
        throw invalidRecoverySession();
      }
      await this.adminHighRisk.verify(tx, headers);

      const consumed = await this.sessionRepository.consumeRecoveryRotation(
        tx,
        session.id,
        session.recoveryRotationGeneration,
      );
      if (!consumed) {
        throw recoveryConflict();
      }
      const batchVersion = await this.recoveryCodeRepository.nextBatchVersion(
        tx,
        actor.userId,
      );
      await this.recoveryCodeRepository.invalidateAllUnused(tx, actor.userId);
      await this.recoveryCodeRepository.issueBatch(
        tx,
        actor.userId,
        batchVersion,
        issued.hashes,
      );
      await this.audit.append(tx, {
        projectId: null,
        actorType: "USER",
        actorId: actor.userId,
        action: "auth.mfa_recovery_rotate",
        targetType: "USER",
        targetId: String(actor.userId),
        eventPayload: {
          batchVersion,
          rotationGeneration: session.recoveryRotationGeneration,
        },
        requestId: input.requestId,
      });
      return { recoveryCodes: issued.plaintextCodes };
    });
  }

  async consume(
    input: ConsumeMfaRecoveryCodeInput,
  ): Promise<ConsumeMfaRecoveryCodeResult> {
    const prepared = await this.prepareChallenge(input);
    const activeHashes = await this.unitOfWork.run((tx) =>
      this.recoveryCodeRepository.findActiveHashes(tx, prepared.userId),
    );
    const matchedHash = await this.recoveryCodeService.findMatchingHash(
      input.code,
      activeHashes,
    );
    if (matchedHash === undefined) {
      await this.rateLimitService.recordFailure(
        prepared.userId,
        input.clientIp,
      );
      throw invalidRecoveryCode();
    }

    const issuedCsrfToken = generateOpaqueToken();
    const csrfHash = this.tokenService.hash(issuedCsrfToken);
    return this.unitOfWork.run(async (tx) => {
      const session = await this.findValidSession(tx, input.cookieHeader);
      if (
        session === undefined ||
        session.authState !== RECOVERY_CHALLENGE_STATE ||
        session.userId !== prepared.userId ||
        !(await this.csrfMatches(tx, session.id, input.csrfToken))
      ) {
        throw invalidRecoverySession();
      }
      const snapshot = await this.userRepository.lockForMfaMutation(
        tx,
        session.userId,
        session.authVersionAtIssue,
      );
      if (snapshot === undefined) {
        throw invalidRecoverySession();
      }
      if (!snapshot.isAdmin) {
        throw notAdmin();
      }
      const factor = await this.factorRepository.findForUpdate(tx, snapshot.id);
      if (factor === undefined || factor.status !== "ACTIVE") {
        throw recoveryConflict();
      }
      await this.rateLimitService.assertAllowed(
        tx,
        snapshot.id,
        input.clientIp,
      );
      const locked = await this.sessionRepository.lockById(tx, session.id);
      if (
        locked === undefined ||
        locked.authState !== RECOVERY_CHALLENGE_STATE ||
        !(await this.csrfMatches(tx, locked.id, input.csrfToken))
      ) {
        throw recoveryConflict();
      }

      const consumed = await this.recoveryCodeRepository.consumeCode(
        tx,
        snapshot.id,
        matchedHash,
      );
      if (!consumed) {
        throw recoveryConflict();
      }
      await this.recoveryCodeRepository.invalidateAllUnused(tx, snapshot.id);
      const upgraded =
        await this.sessionRepository.upgradeRecoveryChallengeToAuthenticated(
          tx,
          locked.id,
        );
      if (!upgraded) {
        throw recoveryConflict();
      }
      await this.csrfRepository.issue(tx, {
        sessionId: locked.id,
        tokenHash: csrfHash.hash,
        expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
      });
      await this.audit.append(tx, {
        projectId: null,
        actorType: "USER",
        actorId: snapshot.id,
        action: "auth.mfa_recovery_consume",
        targetType: "USER",
        targetId: String(snapshot.id),
        eventPayload: { method: "recovery-code" },
        requestId: input.requestId,
      });
      return {
        csrfToken: issuedCsrfToken,
        authState: "AUTHENTICATED",
      };
    });
  }

  private async prepareChallenge(
    input: ConsumeMfaRecoveryCodeInput,
  ): Promise<PreparedRecoveryChallenge> {
    return this.unitOfWork.run(async (tx) => {
      const session = await this.findValidSession(tx, input.cookieHeader);
      if (session === undefined) {
        throw invalidRecoverySession();
      }
      const user = await this.userRepository.findById(tx, session.userId);
      if (
        user === undefined ||
        user.status !== "ACTIVE" ||
        user.disabledAt !== null
      ) {
        throw invalidRecoverySession();
      }
      if (!user.isAdmin) {
        throw notAdmin();
      }
      if (session.authState !== RECOVERY_CHALLENGE_STATE) {
        throw recoveryConflict();
      }
      if (!(await this.csrfMatches(tx, session.id, input.csrfToken))) {
        throw csrfRejected();
      }
      await this.rateLimitService.assertAllowed(tx, user.id, input.clientIp);
      return { session, userId: user.id };
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

  private headers(input: {
    readonly cookieHeader: string | undefined;
    readonly csrfToken: string | undefined;
  }): HttpHeaderBag {
    return {
      cookie: input.cookieHeader,
      "x-csrf-token": input.csrfToken,
    };
  }
}
