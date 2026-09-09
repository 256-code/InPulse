import { createHmac } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import type { TransactionContext } from "../database/transaction-context.js";
import { PostgresUnitOfWork } from "../database/unit-of-work.js";
import { SESSION_HMAC_KEYRING } from "./auth.constants.js";
import {
  blockedUntil,
  normalizeClientIp,
  windowStartedAt,
  type AuthRateLimitRule,
} from "./auth-rate-limit.policy.js";
import {
  PostgresAuthRateLimitRepository,
  type AuthRateLimitCheckDimension,
  type AuthRateLimitWriteDimension,
} from "./auth-rate-limit.repository.js";
import type { VersionedHmacKeyring } from "./keyring.js";
import { mfaRateLimited } from "./mfa-rate-limit.error.js";

const RATE_LIMIT_HASH_PURPOSE = "inpulse-mfa-verify-rate-limit-v1";

export interface MfaRateLimitRule extends AuthRateLimitRule {
  readonly dimension: "USER" | "IP" | "GLOBAL";
}

/** MFA 验证失败的三层限流候选基线，数值与人工评审后的登录规则保持一致。 */
export const DEFAULT_MFA_RATE_LIMIT_RULES: readonly MfaRateLimitRule[] = [
  {
    dimension: "USER",
    bucketType: "MFA",
    windowSeconds: 15 * 60,
    maxAttempts: 5,
    blockSeconds: 15 * 60,
  },
  {
    dimension: "IP",
    bucketType: "MFA",
    windowSeconds: 15 * 60,
    maxAttempts: 20,
    blockSeconds: 15 * 60,
  },
  {
    dimension: "GLOBAL",
    bucketType: "MFA",
    windowSeconds: 5 * 60,
    maxAttempts: 100,
    blockSeconds: 60,
  },
] as const;

/**
 * MFA TOTP/恢复码验证的持久化限流。维度只保存 HMAC 摘要，不保存用户 ID
 * 或客户端 IP 明文；检查在验证事务内进行，失败计数在独立短事务中原子写入。
 */
@Injectable()
export class MfaRateLimitService {
  private readonly rules = DEFAULT_MFA_RATE_LIMIT_RULES;

  constructor(
    private readonly unitOfWork: PostgresUnitOfWork,
    private readonly repository: PostgresAuthRateLimitRepository,
    @Inject(SESSION_HMAC_KEYRING)
    private readonly keyring: VersionedHmacKeyring,
  ) {}

  async assertAllowed(
    tx: TransactionContext,
    userId: number,
    clientIp: string,
    now: Date = new Date(),
  ): Promise<void> {
    const blocked = await this.repository.findBlocked(
      tx,
      this.checkDimensions(userId, clientIp),
      now,
    );
    if (blocked !== undefined) {
      throw mfaRateLimited();
    }
  }

  async recordFailure(
    userId: number,
    clientIp: string,
    now: Date = new Date(),
  ): Promise<void> {
    await this.unitOfWork.run((tx) =>
      this.recordFailureInTransaction(tx, userId, clientIp, now),
    );
  }

  async recordFailureInTransaction(
    tx: TransactionContext,
    userId: number,
    clientIp: string,
    now: Date = new Date(),
  ): Promise<void> {
    const dimensions = this.writeDimensions(userId, clientIp, now);
    await this.repository.recordFailures(tx, dimensions, now);
  }

  private checkDimensions(
    userId: number,
    clientIp: string,
  ): readonly AuthRateLimitCheckDimension[] {
    return this.rules.map((rule) => ({
      bucketType: rule.bucketType,
      dimensionHashes: this.hashes(
        rule.dimension,
        ruleDimensionValue(rule.dimension, userId, clientIp),
      ),
    }));
  }

  private writeDimensions(
    userId: number,
    clientIp: string,
    now: Date,
  ): readonly AuthRateLimitWriteDimension[] {
    return this.rules.flatMap((rule) =>
      this.hashes(
        rule.dimension,
        ruleDimensionValue(rule.dimension, userId, clientIp),
      ).map((dimensionHash) => ({
        bucketType: rule.bucketType,
        dimensionHash,
        windowStartedAt: windowStartedAt(now, rule.windowSeconds),
        maxAttempts: rule.maxAttempts,
        blockedUntil: blockedUntil(now, rule.blockSeconds),
      })),
    );
  }

  private hashes(
    dimension: MfaRateLimitRule["dimension"],
    value: string,
  ): readonly Buffer[] {
    return this.keyring.versions.map((version) =>
      createHmac("sha256", this.keyring.keyFor(version))
        .update(`${RATE_LIMIT_HASH_PURPOSE}\0${dimension}\0${value}`, "utf8")
        .digest(),
    );
  }
}

function ruleDimensionValue(
  dimension: MfaRateLimitRule["dimension"],
  userId: number,
  clientIp: string,
): string {
  switch (dimension) {
    case "USER":
      return `user:${userId}`;
    case "IP":
      return normalizeClientIp(clientIp);
    case "GLOBAL":
      return "global";
  }
}
