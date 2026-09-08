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
  parentSql: Sql,
) => TransactionContext;

/**
 * 用事务绑定的 `TransactionSql` 构造 Drizzle `db` 与 `sql` 上下文。
 *
 * postgres-js 的 `sql.begin` 回传的 `TransactionSql` 没有顶层 `Sql` 的
 * `options`；Drizzle 构造时会写 `client.options.parsers/serializers`，
 * 因此必须复用父连接的 `options`，否则真实事务查询会因缺少 `parsers` 失败。
 */
export const defaultTransactionContextFactory: TransactionContextFactory = (
  txSql,
  parentSql,
) => ({
  db: drizzle(withParentOptions(txSql, parentSql), { schema }),
  sql: txSql,
});

function withParentOptions(txSql: TransactionSql, parentSql: Sql): Sql {
  const tx = txSql as unknown as Sql & { options?: Sql["options"] };
  const parent = parentSql as unknown as { options?: Sql["options"] };
  if (parent.options === undefined) {
    throw new Error("parent postgres-js client exposes no options");
  }
  tx.options = parent.options;
  return tx;
}

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
      callback(this.createTransaction(txSql, this.client.sql)),
    ) as Promise<T>;
  }
}
