import { mfaRecoveryCodes } from "@inpulse/database";

import type { TransactionContext } from "../database/transaction-context.js";

export interface RecoveryCodeHash {
  readonly codeHash: string;
}

export interface ActiveRecoveryCodeHash {
  readonly codeHash: string;
}

export interface MfaRecoveryCodeRepository {
  nextBatchVersion(tx: TransactionContext, userId: number): Promise<number>;
  issueBatch(
    tx: TransactionContext,
    userId: number,
    batchVersion: number,
    hashes: readonly RecoveryCodeHash[],
  ): Promise<void>;
  findActiveHashes(
    tx: TransactionContext,
    userId: number,
  ): Promise<readonly ActiveRecoveryCodeHash[]>;
  consumeCode(
    tx: TransactionContext,
    userId: number,
    codeHash: string,
  ): Promise<boolean>;
  invalidateAllUnused(tx: TransactionContext, userId: number): Promise<number>;
}

/**
 * `app.mfa_recovery_codes` 写入实现。只保存 Argon2id 编码哈希，
 * 调用方必须在同一 `UnitOfWork` 事务内传入哈希，禁止明文 Recovery Code 落库。
 */
export class PostgresMfaRecoveryCodeRepository implements MfaRecoveryCodeRepository {
  async nextBatchVersion(
    tx: TransactionContext,
    userId: number,
  ): Promise<number> {
    const rows = (await tx.sql`
      SELECT coalesce(max(batch_version), 0)::int + 1 AS "batchVersion"
        FROM app.mfa_recovery_codes
       WHERE user_id = ${userId}
    `) as unknown as readonly { batchVersion: number }[];
    return rows[0]?.batchVersion ?? 1;
  }

  async issueBatch(
    tx: TransactionContext,
    userId: number,
    batchVersion: number,
    hashes: readonly RecoveryCodeHash[],
  ): Promise<void> {
    if (hashes.length === 0) {
      throw new Error("recovery code batch must not be empty");
    }
    await tx.db.insert(mfaRecoveryCodes).values(
      hashes.map((hash) => ({
        userId,
        batchVersion,
        codeHash: hash.codeHash,
      })),
    );
  }

  async findActiveHashes(
    tx: TransactionContext,
    userId: number,
  ): Promise<readonly ActiveRecoveryCodeHash[]> {
    return (await tx.sql`
      SELECT code_hash AS "codeHash"
        FROM app.mfa_recovery_codes
       WHERE user_id = ${userId}
         AND used_at IS NULL
       ORDER BY batch_version DESC, id ASC
    `) as unknown as readonly ActiveRecoveryCodeHash[];
  }

  async consumeCode(
    tx: TransactionContext,
    userId: number,
    codeHash: string,
  ): Promise<boolean> {
    const rows = (await tx.sql`
      UPDATE app.mfa_recovery_codes
         SET used_at = now()
       WHERE user_id = ${userId}
         AND code_hash = ${codeHash}
         AND used_at IS NULL
      RETURNING id
    `) as unknown as readonly { id: number }[];
    return rows.length > 0;
  }

  async invalidateAllUnused(
    tx: TransactionContext,
    userId: number,
  ): Promise<number> {
    const rows = (await tx.sql`
      UPDATE app.mfa_recovery_codes
         SET used_at = now()
       WHERE user_id = ${userId}
         AND used_at IS NULL
      RETURNING id
    `) as unknown as readonly { id: number }[];
    return rows.length;
  }
}
