import type { DatabaseClient } from "@inpulse/database/client";
import type { Sql, TransactionSql } from "postgres";
import { describe, expect, test, vi } from "vitest";

import {
  PostgresUnitOfWork,
  defaultTransactionContextFactory,
} from "../src/database/unit-of-work";
import type { TransactionContext } from "../src/database/transaction-context";

type TransactionCallback = (txSql: TransactionSql) => unknown;

function fakeClient(begin: TransactionCallback): DatabaseClient {
  return {
    db: {} as never,
    sql: { begin },
    close: async () => undefined,
  } as unknown as DatabaseClient;
}

function fakeTxSql(): TransactionSql {
  return {
    __tx: true,
    // drizzle 在构造时会写入 options.parsers/serializers，这里提供最小形状。
    options: { parsers: {}, serializers: {} },
  } as unknown as TransactionSql;
}

describe("PostgresUnitOfWork", () => {
  test("run 恰好调用一次 sql.begin 并把同一事务上下文传给回调", async () => {
    const txSql = fakeTxSql();
    const begin = vi.fn(async (cb: TransactionCallback): Promise<unknown> =>
      cb(txSql),
    );

    const factory = vi.fn(
      (txSqlValue: TransactionSql, _parentSql: Sql): TransactionContext => ({
        db: { txSql: txSqlValue } as never,
        sql: txSqlValue,
      }),
    );

    const uow = new PostgresUnitOfWork(fakeClient(begin), factory);
    let received: TransactionContext | undefined;

    const result = await uow.run(async (tx) => {
      received = tx;
      return 7;
    });

    expect(begin).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith(txSql, expect.anything());
    expect(received).toBeDefined();
    expect(received?.sql).toBe(txSql);
    expect(received?.db).toHaveProperty("txSql", txSql);
    expect(result).toBe(7);
  });

  test("回调抛错时向上传播（回滚由 sql.begin 承担）", async () => {
    const begin = vi.fn(async (_cb: TransactionCallback): Promise<unknown> => {
      throw new Error("boom");
    });

    const uow = new PostgresUnitOfWork(fakeClient(begin));

    await expect(uow.run(async () => 1)).rejects.toThrow("boom");
    expect(begin).toHaveBeenCalledTimes(1);
  });

  test("默认工厂返回基于事务 sql 的 db/sql 上下文", () => {
    const txSql = fakeTxSql();
    const parentSql = {
      options: { parsers: {}, serializers: {} },
    } as unknown as Sql;

    const context = defaultTransactionContextFactory(txSql, parentSql);

    expect(context.sql).toBe(txSql);
    expect(context.db).toBeDefined();
    expect(typeof context.db.select).toBe("function");
  });
});
