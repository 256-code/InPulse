import type { TransactionContext } from "../../database/transaction-context.js";

export interface SsoLoginAttempt {
  readonly id: number;
  readonly stateHashKeyVersion: number;
  readonly returnTo: string | null;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
}

export interface SsoLoginAttemptInsert {
  readonly stateHash: Buffer;
  readonly stateHashKeyVersion: number;
  readonly returnTo: string | null;
  readonly expiresAt: Date;
}

export interface SsoLoginAttemptRepository {
  create(tx: TransactionContext, insert: SsoLoginAttemptInsert): Promise<void>;
  findByStateHashes(
    tx: TransactionContext,
    stateHashes: readonly Buffer[],
  ): Promise<SsoLoginAttempt | undefined>;
  consumeOnce(tx: TransactionContext, id: number): Promise<boolean>;
  deleteExpiredBatch(
    tx: TransactionContext,
    batchSize: number,
  ): Promise<number>;
}

/**
 * 一次性登录材料（ADR-032）：只保存 state 的 HMAC-SHA-256 哈希；nonce 与 PKCE
 * code_verifier 由服务端从 state 派生，不落库任何可重放材料。消费使用条件更新，
 * 保证同一个 state 在并发回调下只有一个请求完成 token 交换。
 */
export class PostgresSsoLoginAttemptRepository implements SsoLoginAttemptRepository {
  async create(
    tx: TransactionContext,
    insert: SsoLoginAttemptInsert,
  ): Promise<void> {
    await tx.sql`
      INSERT INTO app.sso_login_attempts (
        state_hash,
        state_hash_key_version,
        return_to,
        expires_at
      )
      VALUES (
        ${insert.stateHash},
        ${insert.stateHashKeyVersion},
        ${insert.returnTo},
        ${insert.expiresAt.toISOString()}::timestamptz
      )
    `;
  }

  async findByStateHashes(
    tx: TransactionContext,
    stateHashes: readonly Buffer[],
  ): Promise<SsoLoginAttempt | undefined> {
    if (stateHashes.length === 0) {
      return undefined;
    }
    const rows = (await tx.sql`
      SELECT id,
             state_hash_key_version AS "stateHashKeyVersion",
             return_to AS "returnTo",
             expires_at AS "expiresAt",
             consumed_at AS "consumedAt"
        FROM app.sso_login_attempts
       WHERE state_hash IN ${tx.sql(stateHashes)}
       ORDER BY id
       LIMIT 1
    `) as unknown as readonly (Omit<
      SsoLoginAttempt,
      "expiresAt" | "consumedAt"
    > & {
      readonly expiresAt: string;
      readonly consumedAt: string | null;
    })[];
    const row = rows[0];
    if (row === undefined) {
      return undefined;
    }
    return {
      ...row,
      expiresAt: new Date(row.expiresAt),
      consumedAt: row.consumedAt === null ? null : new Date(row.consumedAt),
    };
  }

  async consumeOnce(tx: TransactionContext, id: number): Promise<boolean> {
    const rows = (await tx.sql`
      UPDATE app.sso_login_attempts
         SET consumed_at = now()
       WHERE id = ${id}
         AND consumed_at IS NULL
         AND expires_at > now()
      RETURNING id
    `) as unknown as readonly { id: number }[];
    return rows.length > 0;
  }

  async deleteExpiredBatch(
    tx: TransactionContext,
    batchSize: number,
  ): Promise<number> {
    const rows = (await tx.sql`
      DELETE FROM app.sso_login_attempts
       WHERE id IN (
         SELECT id
           FROM app.sso_login_attempts
          WHERE expires_at <= now()
             OR consumed_at <= now() - interval '1 hour'
          ORDER BY id
          LIMIT ${batchSize}
          FOR UPDATE SKIP LOCKED
       )
      RETURNING id
    `) as unknown as readonly { id: number }[];
    return rows.length;
  }
}
