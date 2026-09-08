import { and, eq, lte } from "drizzle-orm";

import { sessionCsrfTokens } from "@inpulse/database";
import type { TransactionContext } from "../database/transaction-context.js";
import { MAX_AUTH_CSRF_TOKENS } from "./csrf.http.js";

export interface SessionCsrfTokenInsert {
  readonly sessionId: number;
  readonly tokenHash: Buffer;
  readonly expiresAt: Date;
}

export interface SessionCsrfTokenRepository {
  issue(tx: TransactionContext, insert: SessionCsrfTokenInsert): Promise<void>;
}

/**
 * 在 Session 行锁内为认证 Session 签发 CSRF 哈希：先删除过期项，
 * 再淘汰最早项使每个 Session 最多保留 4 个有效 Hash。
 */
export class PostgresSessionCsrfTokenRepository implements SessionCsrfTokenRepository {
  async issue(
    tx: TransactionContext,
    insert: SessionCsrfTokenInsert,
  ): Promise<void> {
    const locked = (await tx.sql`
      SELECT id
        FROM app.user_sessions
       WHERE id = ${insert.sessionId}
       FOR UPDATE
    `) as unknown as readonly { id: number }[];
    if (locked.length === 0) {
      throw new Error(`user session ${insert.sessionId} does not exist`);
    }

    await tx.db
      .delete(sessionCsrfTokens)
      .where(
        and(
          eq(sessionCsrfTokens.sessionId, insert.sessionId),
          lte(sessionCsrfTokens.expiresAt, new Date()),
        ),
      );

    const counts = (await tx.sql`
      SELECT count(*)::int AS count
        FROM app.session_csrf_tokens
       WHERE session_id = ${insert.sessionId}
    `) as unknown as readonly { count: number }[];
    if ((counts[0]?.count ?? 0) >= MAX_AUTH_CSRF_TOKENS) {
      await tx.sql`
        DELETE FROM app.session_csrf_tokens
         WHERE session_id = ${insert.sessionId}
           AND token_hash = (
             SELECT token_hash
               FROM app.session_csrf_tokens
              WHERE session_id = ${insert.sessionId}
              ORDER BY issued_at ASC, token_hash ASC
              LIMIT 1
           )
      `;
    }

    await tx.db.insert(sessionCsrfTokens).values({
      sessionId: insert.sessionId,
      tokenHash: insert.tokenHash,
      expiresAt: insert.expiresAt,
    });
  }
}
