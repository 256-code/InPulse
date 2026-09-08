import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@inpulse/database";
import type { DatabaseClient } from "@inpulse/database/client";
import type { Sql, TransactionSql } from "postgres";
import type { TransactionContext } from "./transaction-context.js";

export interface UnitOfWork {
  run<T>(callback: (tx: TransactionContext) => Promise<T>): Promise<T>;
}

export type TransactionContextFactory = (
  txSql: TransactionSql,
) => TransactionContext;

/** 用事务绑定的 `TransactionSql` 构造 Drizzle `db` 与 `sql` 上下文。 */
export const defaultTransactionContextFactory: TransactionContextFactory = (
  txSql,
) => ({
  // postgres-js 的类型未把 TransactionSql 建模为 Sql；运行期它完全可作为
  // Drizzle 客户端使用，这里只需一次显式收窄。
  db: drizzle(txSql as unknown as Sql, { schema }),
  sql: txSql,
});

/**
 * 基于 postgres-js `sql.begin` 的 `UnitOfWork`：
 * 只创建一个事务，把同一个 `TransactionContext` 传给回调；
 * 正常返回即提交，抛错即回滚。
 */
export class PostgresUnitOfWork implements UnitOfWork {
  private readonly createTransaction: TransactionContextFactory;

  constructor(
    private readonly client: DatabaseClient,
    createTransaction: TransactionContextFactory = defaultTransactionContextFactory,
  ) {
    this.createTransaction = createTransaction;
  }

  run<T>(callback: (tx: TransactionContext) => Promise<T>): Promise<T> {
    return this.client.sql.begin(async (txSql) =>
      callback(this.createTransaction(txSql)),
    ) as Promise<T>;
  }
}
