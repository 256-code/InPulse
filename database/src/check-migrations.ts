import { discoverMigrations } from "./migrations.js";

const migrations = await discoverMigrations();

for (const migration of migrations) {
  process.stdout.write(
    `${migration.name}  sha256:${migration.checksum.slice(0, 16)}\n`
  );
}

process.stdout.write(`Validated ${migrations.length} SQL migration(s).\n`);
