import type { TransactionContext } from "../database/transaction-context.js";
export interface SessionCleanupBatch {
  readonly deletedUserSessions: number;
  readonly deletedSessionCsrfTokens: number;
  readonly deletedPreauthSessions: number;
}
export interface SessionCleanupRepository {
  cleanupBatch(
    tx: TransactionContext,
    batchSize: number,
  ): Promise<SessionCleanupBatch>;
}
/**
 * Session 清理的 PostgreSQL 适配器。
 *
 * 每个批次在调用方事务内按主键分批锁定并删除三类数据：
 * - 撤销超过 30 天或绝对过期超过 7 天的 user_sessions；
 * - 已过期的 session_csrf_tokens；
 * - 已过期或已消费的 preauth_sessions。
 *
 * 先删除 user_sessions 再删除 CSRF，锁序与签发路径一致
 * （旧 Session 行 -> 其 CSRF），避免一次全表扫描或无界删除。
 */
export class PostgresSessionCleanupRepository implements SessionCleanupRepository {
  async cleanupBatch(
    tx: TransactionContext,
    batchSize: number,
  ): Promise<SessionCleanupBatch> {
    const sessionRows = (await tx.sql`
      SELECT id
        FROM app.user_sessions
       WHERE revoked_at <= now() - interval '30 days'
          OR absolute_expires_at <= now() - interval '7 days'
       ORDER BY id
       LIMIT ${batchSize}
       FOR UPDATE SKIP LOCKED
    `) as unknown as readonly { id: number }[];
    const sessionIds = sessionRows.map((row) => row.id);
    const deletedUserSessions =
      sessionIds.length === 0
        ? 0
        : (
            (await tx.sql`
              DELETE FROM app.user_sessions
               WHERE id = ANY(${sessionIds}::bigint[])
              RETURNING id
            `) as unknown as readonly { id: number }[]
          ).length;
    const csrfRows = (await tx.sql`
      SELECT session_id, token_hash
        FROM app.session_csrf_tokens
       WHERE expires_at <= now()
       ORDER BY session_id, token_hash
       LIMIT ${batchSize}
       FOR UPDATE SKIP LOCKED
    `) as unknown as readonly {
      readonly session_id: number;
      readonly token_hash: Buffer;
    }[];
    const csrfHashes = csrfRows.map((row) => row.token_hash);
    const csrfHashesParameter = tx.sql.array(csrfHashes, 17);
    const deletedSessionCsrfTokens =
      csrfHashes.length === 0
        ? 0
        : (
            (await tx.sql`
              DELETE FROM app.session_csrf_tokens
               WHERE token_hash = ANY(${csrfHashesParameter})
              RETURNING token_hash
            `) as unknown as readonly { token_hash: Buffer }[]
          ).length;
    const preauthRows = (await tx.sql`
      SELECT id
        FROM app.preauth_sessions
       WHERE expires_at <= now()
          OR consumed_at IS NOT NULL
       ORDER BY id
       LIMIT ${batchSize}
       FOR UPDATE SKIP LOCKED
    `) as unknown as readonly { id: number }[];
    const preauthIds = preauthRows.map((row) => row.id);
    const deletedPreauthSessions =
      preauthIds.length === 0
        ? 0
        : (
            (await tx.sql`
              DELETE FROM app.preauth_sessions
               WHERE id = ANY(${preauthIds}::bigint[])
              RETURNING id
            `) as unknown as readonly { id: number }[]
          ).length;
    return {
      deletedUserSessions,
      deletedSessionCsrfTokens,
      deletedPreauthSessions,
    };
  }
}
