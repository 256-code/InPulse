import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface Migration {
  readonly name: string;
  readonly checksum: string;
  readonly sql: string;
}

const migrationNamePattern = /^\d{4}_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/;
const transactionControlPattern =
  /^\s*(?:BEGIN|START\s+TRANSACTION|COMMIT|ROLLBACK)\s*;/imu;
const destructivePattern =
  /\b(DROP\s+(TABLE|COLUMN|SCHEMA)|TRUNCATE\s+TABLE)\b/iu;

export function migrationsDirectory(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../migrations");
}

export async function discoverMigrations(
  directory = migrationsDirectory(),
): Promise<readonly Migration[]> {
  const names = (await readdir(directory))
    .filter((name) => name.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right, "en"));

  if (names.length === 0) {
    throw new Error(`No SQL migrations found in ${directory}`);
  }

  const seenOrdinals = new Set<string>();
  const migrations: Migration[] = [];

  for (const name of names) {
    if (!migrationNamePattern.test(name)) {
      throw new Error(
        `Invalid migration name "${name}"; expected 0001_lowercase_name.sql`,
      );
    }

    const ordinal = name.slice(0, 4);
    if (seenOrdinals.has(ordinal)) {
      throw new Error(`Duplicate migration ordinal: ${ordinal}`);
    }
    seenOrdinals.add(ordinal);

    const sql = await readFile(resolve(directory, name), "utf8");
    if (!sql.trim()) {
      throw new Error(`Migration "${name}" is empty`);
    }
    if (transactionControlPattern.test(sql)) {
      throw new Error(
        `Migration "${name}" contains transaction control; the runner owns transactions`,
      );
    }
    if (!name.includes("_contract_") && destructivePattern.test(sql)) {
      throw new Error(
        `Migration "${name}" contains destructive DDL; use a reviewed *_contract_* migration`,
      );
    }

    migrations.push({
      name,
      checksum: createHash("sha256").update(sql, "utf8").digest("hex"),
      sql,
    });
  }

  return migrations;
}
