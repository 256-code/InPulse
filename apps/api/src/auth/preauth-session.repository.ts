import { and, eq, gt, isNull, sql } from "drizzle-orm";

import { preauthSessions } from "@inpulse/database";
import type { TransactionContext } from "../database/transaction-context.js";

export interface PreauthSession {
  readonly id: number;
  readonly tokenHash: Buffer;
  readonly tokenHashKeyVersion: number;
  readonly csrfTokenHash: Buffer;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
}

export interface PreauthSessionInsert {
  readonly tokenHash: Buffer;
  readonly tokenHashKeyVersion: number;
  readonly csrfTokenHash: Buffer;
  readonly expiresAt: Date;
}

export interface PreauthSessionRepository {
  create(
    tx: TransactionContext,
    insert: PreauthSessionInsert,
  ): Promise<PreauthSession>;
  findByTokenHash(
    tx: TransactionContext,
    tokenHash: Buffer,
  ): Promise<PreauthSession | undefined>;
  consumeOnce(tx: TransactionContext, id: number, now?: Date): Promise<boolean>;
}

type PreauthSessionRow = typeof preauthSessions.$inferSelect;

function mapRow(row: PreauthSessionRow): PreauthSession {
  return {
    id: row.id,
    tokenHash: row.tokenHash,
    tokenHashKeyVersion: row.tokenHashKeyVersion,
    csrfTokenHash: row.csrfTokenHash,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    consumedAt: row.consumedAt,
  };
}

/**
 * `app.preauth_sessions` 的 PostgreSQL 实现。所有方法显式接收
 * `UnitOfWork` 创建的同一个 `TransactionContext`，不自行创建事务、不使用全局
 * Drizzle Client。`consumeOnce` 用条件更新保证同一个预认证会话只被消费一次，
 * 过期或被消费的行返回 `false`，与登录防 Session-Fixation/单次消费一致。
 * `consumed_at` 一律取数据库时钟（与 `created_at` 同源），不依赖 API 进程时钟。
 */
export class PostgresPreauthSessionRepository implements PreauthSessionRepository {
  async create(
    tx: TransactionContext,
    insert: PreauthSessionInsert,
  ): Promise<PreauthSession> {
    const rows = await tx.db
      .insert(preauthSessions)
      .values({
        tokenHash: insert.tokenHash,
        tokenHashKeyVersion: insert.tokenHashKeyVersion,
        csrfTokenHash: insert.csrfTokenHash,
        expiresAt: insert.expiresAt,
      })
      .returning();
    return mapRow(rows[0]!);
  }

  async findByTokenHash(
    tx: TransactionContext,
    tokenHash: Buffer,
  ): Promise<PreauthSession | undefined> {
    const rows = await tx.db
      .select()
      .from(preauthSessions)
      .where(eq(preauthSessions.tokenHash, tokenHash))
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : mapRow(row);
  }

  /**
   * 原子消费：仅当会话未被消费且未过期时写入 `consumed_at`。
   *
   * `consumed_at` 一律取数据库时钟 `now()`，与 `created_at`（默认同为 `now()`）
   * 处于同一时钟域，避免 API 进程与 PostgreSQL 的时钟偏差写入早于 `created_at` 的值，
   * 触发 `preauth_sessions_consumed_at_check` 让登录接口 500。
   * 可选参数 `now` 只覆盖过期判定时刻，供测试注入“当前时刻”，不落库。
   */
  async consumeOnce(
    tx: TransactionContext,
    id: number,
    now?: Date,
  ): Promise<boolean> {
    const rows = await tx.db
      .update(preauthSessions)
      .set({ consumedAt: sql`now()` })
      .where(
        and(
          eq(preauthSessions.id, id),
          isNull(preauthSessions.consumedAt),
          gt(preauthSessions.expiresAt, now ?? sql`now()`),
        ),
      )
      .returning({ id: preauthSessions.id });
    return rows.length > 0;
  }
}
