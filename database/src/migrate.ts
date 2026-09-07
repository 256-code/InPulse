import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

import { resolveDatabaseUrl } from "./config.js";
import { discoverMigrations } from "./migrations.js";

const advisoryLockName = "inpulse:database:migrations:v1";

export interface MigrationResult {
  readonly applied: readonly string[];
  readonly alreadyApplied: readonly string[];
}

export async function migrate(databaseUrl: string): Promise<MigrationResult> {
  const migrations = await discoverMigrations();
  const sql = postgres(databaseUrl, {
    connection: { application_name: "inpulse-migrate" },
    max: 1,
    onnotice: () => undefined,
    prepare: false,
  });
  const applied: string[] = [];
  const alreadyApplied: string[] = [];
  let locked = false;

  try {
    await sql.unsafe("SET ROLE app_owner");
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS app.schema_migrations (
        name TEXT PRIMARY KEY,
        checksum TEXT NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
        execution_ms INTEGER NOT NULL CHECK (execution_ms >= 0),
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await sql`
      SELECT pg_advisory_lock(hashtextextended(${advisoryLockName}, 0))
    `;
    locked = true;

    const rows = await sql<
      Array<{ name: string; checksum: string }>
    >`SELECT name, checksum FROM app.schema_migrations ORDER BY name`;
    const history = new Map(rows.map((row) => [row.name, row.checksum]));

    for (const migration of migrations) {
      const recordedChecksum = history.get(migration.name);
      if (recordedChecksum !== undefined) {
        if (recordedChecksum !== migration.checksum) {
          throw new Error(
            `Applied migration "${migration.name}" was modified; expected ${recordedChecksum}, found ${migration.checksum}`,
          );
        }
        alreadyApplied.push(migration.name);
        continue;
      }

      const startedAt = performance.now();
      await sql.begin(async (transaction) => {
        await transaction.unsafe("SET LOCAL ROLE app_owner");
        await transaction.unsafe(migration.sql);
        await transaction.unsafe("SET LOCAL ROLE app_owner");
        const executionMs = Math.max(
          0,
          Math.round(performance.now() - startedAt),
        );
        await transaction`
          INSERT INTO app.schema_migrations (name, checksum, execution_ms)
          VALUES (${migration.name}, ${migration.checksum}, ${executionMs})
        `;
      });
      applied.push(migration.name);
    }

    return { applied, alreadyApplied };
  } finally {
    if (locked) {
      await sql`
        SELECT pg_advisory_unlock(hashtextextended(${advisoryLockName}, 0))
      `.catch(() => undefined);
    }
    await sql.end({ timeout: 5 });
  }
}

async function runCli(): Promise<void> {
  const databaseUrl = await resolveDatabaseUrl("MIGRATION");
  const result = await migrate(databaseUrl);
  for (const name of result.applied) {
    process.stdout.write(`Applied ${name}\n`);
  }
  process.stdout.write(
    `Migration complete: ${result.applied.length} applied, ${result.alreadyApplied.length} already present.\n`,
  );
}

const isCli =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isCli) {
  await runCli();
}
