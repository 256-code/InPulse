import type { TransactionContext } from "../database/transaction-context.js";
import type { AuthRateLimitBucketType } from "./auth-rate-limit.policy.js";

export interface AuthRateLimitCheckDimension {
  readonly bucketType: AuthRateLimitBucketType;
  readonly dimensionHashes: readonly Buffer[];
}

export interface AuthRateLimitBlock {
  readonly bucketType: AuthRateLimitBucketType;
  readonly blockedUntil: Date;
}

export interface AuthRateLimitWriteDimension {
  readonly bucketType: AuthRateLimitBucketType;
  readonly dimensionHash: Buffer;
  readonly windowStartedAt: Date;
  readonly maxAttempts: number;
  readonly blockedUntil: Date;
}

export interface AuthRateLimitRepository {
  findBlocked(
    tx: TransactionContext,
    dimensions: readonly AuthRateLimitCheckDimension[],
    now: Date,
  ): Promise<AuthRateLimitBlock | undefined>;
  recordFailures(
    tx: TransactionContext,
    dimensions: readonly AuthRateLimitWriteDimension[],
    now: Date,
  ): Promise<void>;
  clearAccount(
    tx: TransactionContext,
    dimensionHashes: readonly Buffer[],
  ): Promise<void>;
}

type BlockedRow = {
  readonly blockedUntil: Date;
};

/**
 * `app.auth_rate_limit_buckets` 的 PostgreSQL 实现。所有方法只接收调用方
 * 持有的 `TransactionContext`，不自行开启事务。失败计数使用主键冲突更新，
 * 保持同一窗口内计数与阻断时间原子生效；并发更新由 PostgreSQL 行锁串行化。
 */
export class PostgresAuthRateLimitRepository implements AuthRateLimitRepository {
  async findBlocked(
    tx: TransactionContext,
    dimensions: readonly AuthRateLimitCheckDimension[],
    now: Date,
  ): Promise<AuthRateLimitBlock | undefined> {
    const nowIso = now.toISOString();
    for (const dimension of dimensions) {
      for (const dimensionHash of dimension.dimensionHashes) {
        const rows = (await tx.sql`
          SELECT blocked_until AS "blockedUntil"
            FROM app.auth_rate_limit_buckets
           WHERE bucket_type = ${dimension.bucketType}
             AND dimension_hash = ${dimensionHash}
             AND blocked_until > ${nowIso}
           LIMIT 1
        `) as unknown as readonly BlockedRow[];
        const row = rows[0];
        if (row !== undefined) {
          return {
            bucketType: dimension.bucketType,
            blockedUntil: row.blockedUntil,
          };
        }
      }
    }
    return undefined;
  }

  async recordFailures(
    tx: TransactionContext,
    dimensions: readonly AuthRateLimitWriteDimension[],
    now: Date,
  ): Promise<void> {
    const nowIso = now.toISOString();
    for (const dimension of dimensions) {
      const windowStartedAt = dimension.windowStartedAt.toISOString();
      const blockedUntil = dimension.blockedUntil.toISOString();
      await tx.sql`
        INSERT INTO app.auth_rate_limit_buckets (
          bucket_type,
          dimension_hash,
          window_started_at,
          attempt_count,
          blocked_until,
          updated_at
        )
        VALUES (
          ${dimension.bucketType},
          ${dimension.dimensionHash},
          ${windowStartedAt},
          1,
          CASE
            WHEN ${dimension.maxAttempts} <= 1
              THEN ${blockedUntil}
            ELSE NULL
          END,
          ${nowIso}
        )
        ON CONFLICT (bucket_type, dimension_hash, window_started_at)
        DO UPDATE SET
          attempt_count = app.auth_rate_limit_buckets.attempt_count + 1,
          blocked_until = CASE
            WHEN app.auth_rate_limit_buckets.blocked_until IS NOT NULL
             AND app.auth_rate_limit_buckets.blocked_until > ${nowIso}
              THEN app.auth_rate_limit_buckets.blocked_until
            WHEN app.auth_rate_limit_buckets.attempt_count + 1 >= ${dimension.maxAttempts}
              THEN ${blockedUntil}
            ELSE NULL
          END,
          updated_at = ${nowIso}
      `;
    }
  }

  async clearAccount(
    tx: TransactionContext,
    dimensionHashes: readonly Buffer[],
  ): Promise<void> {
    for (const dimensionHash of dimensionHashes) {
      await tx.sql`
        DELETE FROM app.auth_rate_limit_buckets
         WHERE bucket_type = 'ACCOUNT'
           AND dimension_hash = ${dimensionHash}
      `;
    }
  }
}
