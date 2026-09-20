import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";

import * as schema from "../schema/index.js";

export interface DatabaseClientOptions {
  applicationName?: string;
  maxConnections?: number;
}

export interface DatabaseClient {
  readonly db: PostgresJsDatabase<typeof schema>;
  readonly sql: Sql;
  close(): Promise<void>;
}

/** postgres.js 只在参数是 JS Date 时推断出的类型编号（timestamptz）。 */
const TIMESTAMPTZ_OID = 1184;

/**
 * 构造 Drizzle 客户端，并还原 postgres.js 的 timestamptz 编码器。
 *
 * drizzle-orm 的 postgres-js 驱动在构造时会把 `client.options.serializers` 中日期/JSON
 * 类型的编码器改写成恒等函数（日期编码交给它自己的列映射），而 postgres.js 的原生
 * sql 标签模板与连接共用同一个 `options` 对象。被改写之后，原生 sql 标签模板再传
 * JS `Date` 就不会走日期编码器，Bind 阶段直接抛
 * `The "string" argument must be of type string ... Received an instance of Date`。
 *
 * postgres.js 只会把 JS `Date` 推断成 timestamptz，而 drizzle 的日期列在映射阶段已经
 * 把值转成 ISO 字符串（字符串经过两种编码器结果一致），因此这里只还原 timestamptz
 * 一个编码器；JSON（114/3802）保持 drizzle 的恒等函数，避免与 drizzle 自身的
 * `JSON.stringify` 叠加成二次编码。
 */
export function createDrizzleDb(sql: Sql): PostgresJsDatabase<typeof schema> {
  const serializers = (
    sql as unknown as { options?: { serializers?: Record<string, unknown> } }
  ).options?.serializers;
  const timestamptzSerializer = serializers?.[String(TIMESTAMPTZ_OID)];
  const db = drizzle(sql, { schema });
  if (serializers !== undefined && timestamptzSerializer !== undefined) {
    serializers[String(TIMESTAMPTZ_OID)] = timestamptzSerializer;
  }
  return db;
}

export function createDatabaseClient(
  databaseUrl: string,
  options: DatabaseClientOptions = {},
): DatabaseClient {
  const sql = postgres(databaseUrl, {
    connection: {
      application_name: options.applicationName ?? "inpulse-api",
    },
    max: options.maxConnections ?? 10,
  });

  return {
    db: createDrizzleDb(sql),
    sql,
    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}

export type AppDatabase = PostgresJsDatabase<typeof schema>;
