import type { AppDatabase } from "@inpulse/database/client";
import type { TransactionSql } from "postgres";

/**
 * 技术设计 §2.2：`UnitOfWork.run` 创建的唯一事务上下文。
 * 所有 CommandPort、Repository、审计、通知和投影写方法必须显式接收它，
 * `sql` 是事务绑定的 postgres-js 句柄（`TransactionSql`），
 * 且事务回调中禁止使用全局 Drizzle Client。
 */
export interface TransactionContext {
  readonly db: AppDatabase;
  readonly sql: TransactionSql;
}
