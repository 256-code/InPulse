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
    db: drizzle(sql, { schema }),
    sql,
    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}

export type AppDatabase = PostgresJsDatabase<typeof schema>;
