import { createHmac } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import type { TransactionContext } from "../database/transaction-context.js";
import { PostgresUnitOfWork } from "../database/unit-of-work.js";
import { SESSION_HMAC_KEYRING } from "./auth.constants.js";
import {
  blockedUntil,
  DEFAULT_LOGIN_RATE_LIMIT_RULES,
  normalizeClientIp,
  normalizeLoginName,
  windowStartedAt,
  type AuthRateLimitBucketType,
} from "./auth-rate-limit.policy.js";
import {
  PostgresAuthRateLimitRepository,
  type AuthRateLimitCheckDimension,
  type AuthRateLimitWriteDimension,
} from "./auth-rate-limit.repository.js";
import type { VersionedHmacKeyring } from "./keyring.js";
import { LoginError } from "./login.error.js";

const RATE_LIMIT_HASH_PURPOSE = "inpulse-auth-rate-limit-v1";

/**
 * 登录三层限流服务：
 * - 检查放在登录准备事务内，Argon2 计算前阻断；
 * - 密码失败后在独立短事务中记录账号、IP、全局计数；
 * - 登录成功时清除账号失败计数，允许正确密码立即通过。
 *
 * 维度只保存 HMAC-SHA-256 摘要，不保存明文登录名或客户端 IP。
 */
@Injectable()
export class LoginRateLimitService {
  private readonly rules = DEFAULT_LOGIN_RATE_LIMIT_RULES;

  constructor(
    private readonly unitOfWork: PostgresUnitOfWork,
    private readonly repository: PostgresAuthRateLimitRepository,
    @Inject(SESSION_HMAC_KEYRING)
    private readonly keyring: VersionedHmacKeyring,
  ) {}

  async assertAllowed(
    tx: TransactionContext,
    loginName: string,
    clientIp: string,
  ): Promise<void> {
    const now = new Date();
    const dimensions = this.checkDimensions(loginName, clientIp);
    const blocked = await this.repository.findBlocked(tx, dimensions, now);
    if (blocked !== undefined) {
      throw rateLimited();
    }
  }

  async recordFailure(loginName: string, clientIp: string): Promise<void> {
    const now = new Date();
    await this.unitOfWork.run((tx) =>
      this.recordFailureInTransaction(tx, loginName, clientIp, now),
    );
  }

  async recordFailureInTransaction(
    tx: TransactionContext,
    loginName: string,
    clientIp: string,
    now: Date = new Date(),
  ): Promise<void> {
    const dimensions = this.writeDimensions(loginName, clientIp, now);
    await this.repository.recordFailures(tx, dimensions, now);
  }

  async clearAccount(tx: TransactionContext, loginName: string): Promise<void> {
    const dimensionHashes = this.hashes(
      "ACCOUNT",
      normalizeLoginName(loginName),
    );
    await this.repository.clearAccount(tx, dimensionHashes);
  }

  private checkDimensions(
    loginName: string,
    clientIp: string,
  ): readonly AuthRateLimitCheckDimension[] {
    const accountHashes = this.hashes("ACCOUNT", normalizeLoginName(loginName));
    const ipHashes = this.hashes("IP", normalizeClientIp(clientIp));
    const globalHashes = this.hashes("GLOBAL", "global");
    return this.rules.map((rule) => ({
      bucketType: rule.bucketType,
      dimensionHashes:
        rule.bucketType === "ACCOUNT"
          ? accountHashes
          : rule.bucketType === "IP"
            ? ipHashes
            : globalHashes,
    }));
  }

  private writeDimensions(
    loginName: string,
    clientIp: string,
    now: Date,
  ): readonly AuthRateLimitWriteDimension[] {
    const accountHashes = this.hashes("ACCOUNT", normalizeLoginName(loginName));
    const ipHashes = this.hashes("IP", normalizeClientIp(clientIp));
    const globalHashes = this.hashes("GLOBAL", "global");
    const dimensions: AuthRateLimitWriteDimension[] = [];
    for (const rule of this.rules) {
      const hashes =
        rule.bucketType === "ACCOUNT"
          ? accountHashes
          : rule.bucketType === "IP"
            ? ipHashes
            : globalHashes;
      const windowStart = windowStartedAt(now, rule.windowSeconds);
      for (const dimensionHash of hashes) {
        dimensions.push({
          bucketType: rule.bucketType,
          dimensionHash,
          windowStartedAt: windowStart,
          maxAttempts: rule.maxAttempts,
          blockedUntil: blockedUntil(now, rule.blockSeconds),
        });
      }
    }
    return dimensions;
  }

  private hashes(
    bucketType: AuthRateLimitBucketType,
    dimension: string,
  ): readonly Buffer[] {
    return this.keyring.versions.map((version) =>
      createHmac("sha256", this.keyring.keyFor(version))
        .update(
          `${RATE_LIMIT_HASH_PURPOSE}\0${bucketType}\0${dimension}`,
          "utf8",
        )
        .digest(),
    );
  }
}

function rateLimited(): LoginError {
  return new LoginError(
    429,
    "LOGIN_RATE_LIMITED",
    "登录失败次数过多，请稍后再试",
    "login-rate-limited",
  );
}
