import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  createDatabaseClient,
  type DatabaseClient,
} from "@inpulse/database/client";
import { migrate } from "@inpulse/database/migrate";

import {
  decryptBackupPackageFile,
  decryptBackupPackageToFile,
  parseBackupManifest,
  runBackup,
  verifyBackupManifest,
} from "../src/backup.js";
import type { ArchiveSigningKeyring, BackupConfig } from "../src/config.js";

const PREFIX = "inpulse/backups";
const BUCKET = "inpulse-backup";

const keyring: ArchiveSigningKeyring = {
  currentVersion: 1,
  keys: new Map([[1, Buffer.alloc(32, 0x5a)]]),
};

interface SeedFixture {
  readonly chainId: string;
  readonly projectId: number;
  readonly userId: number;
  readonly recordHash: string;
}

interface CapturedPut {
  readonly key: string;
  readonly body: Buffer;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Set ${name}; PostgreSQL integration tests never silently skip`,
    );
  }
  return value;
}

function roleUrl(baseUrl: string, role: string): string {
  const url = new URL(baseUrl);
  url.username = role;
  url.password = "";
  return url.toString();
}

function databaseUrlFor(baseUrl: string, database: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

async function expectPgError(
  operation: Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await operation;
  } catch (error) {
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error(`expected PostgreSQL error ${code}, but it succeeded`);
}

function wormStub() {
  const puts: CapturedPut[] = [];
  const objects = new Map<string, Buffer>();
  const fetchImpl = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = input instanceof URL ? input : new URL(String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    const segments = url.pathname
      .split("/")
      .filter((segment) => segment.length > 0);
    if (decodeURIComponent(segments[0] ?? "") !== BUCKET) {
      throw new Error("unexpected bucket in stub");
    }
    const objectKey = segments
      .slice(1)
      .map((segment) => decodeURIComponent(segment))
      .join("/");
    if (method === "PUT") {
      const body = init?.body;
      if (!Buffer.isBuffer(body)) {
        throw new Error("stub expects a Buffer PUT body");
      }
      objects.set(objectKey, Buffer.from(body));
      puts.push({ key: objectKey, body: Buffer.from(body) });
      return new Response(null, { status: 200 });
    }
    const stored = objects.get(objectKey);
    if (stored === undefined) {
      return new Response(null, { status: 404 });
    }
    return new Response(new Uint8Array(stored), { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, puts, objects };
}

/** 与 compose ops 镜像一致：生产镜像内置 PostgreSQL 18 客户端（路径可由环境变量指定）。 */
function pgDumpPath(): string {
  return process.env["INPULSE_BACKUP_PG_DUMP"]?.trim() || "pg_dump";
}

function pgRestorePath(): string {
  const explicit = process.env["INPULSE_BACKUP_PG_RESTORE"]?.trim();
  if (explicit) {
    return explicit;
  }
  const dump = pgDumpPath();
  const suffix = dump.endsWith(".exe") ? ".exe" : "";
  return join(dirname(dump), `pg_restore${suffix}`);
}

function backupConfig(localDir: string): BackupConfig {
  return {
    databaseUrl: backupUrl,
    localDir,
    localRetentionDays: 7,
    pgDumpPath: pgDumpPath(),
    keyring,
    upload: {
      endpoint: new URL("https://worm.example.com"),
      region: "cn-north-1",
      bucket: BUCKET,
      accessKeyId: "AKIDBACKUP",
      secretAccessKey: "backup-secret",
      prefix: PREFIX,
      forcePathStyle: true,
      objectLock: { mode: "COMPLIANCE", retainDays: 30 },
    },
    fetchTimeoutMs: 10_000,
    gitSha: "f".repeat(40),
    imageRef: "inpulse/ops:0.0.0-it@sha256:" + "b".repeat(64),
  };
}

let baseUrl = "";
let backupUrl = "";
let seed: SeedFixture | undefined;
let backupClient: DatabaseClient | undefined;

async function seedFixture(client: DatabaseClient): Promise<SeedFixture> {
  const recordHash = randomBytes(32);
  const prevHash = Buffer.alloc(32);
  const tokenHash = randomBytes(32);
  const csrfHash = randomBytes(32);
  const loginName = `backup_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const code = `BKUP${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
  const requestId = randomUUID();
  const occurredAt = new Date("2042-03-04T05:06:07.000Z");

  return client.sql.begin(async (tx) => {
    await tx.unsafe("SET LOCAL ROLE app_owner");
    const [user] = await tx<Array<{ id: number }>>`
      INSERT INTO app.users (login_name, name, password_hash)
      VALUES (
        ${loginName},
        ${"Backup Fixture"},
        ${"$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture-hash"}
      )
      RETURNING id
    `;
    if (user === undefined) {
      throw new Error("user fixture insert returned no row");
    }
    const [project] = await tx<Array<{ id: number }>>`
      INSERT INTO app.projects (code, name, created_by)
      VALUES (${code}, ${`Backup ${code}`}, ${user.id})
      RETURNING id
    `;
    if (project === undefined) {
      throw new Error("project fixture insert returned no row");
    }
    await tx`
      INSERT INTO app.project_members (project_id, user_id)
      VALUES (${project.id}, ${user.id})
    `;
    await tx`
      INSERT INTO app.modules (project_id, name, kind, created_by)
      VALUES (${project.id}, '未分类', 'UNCLASSIFIED', ${user.id})
    `;
    const chainId = `PROJECT:${project.id}`;
    await tx`
      INSERT INTO app.audit_chain_heads (
        chain_id,
        project_id,
        last_sequence,
        last_hash,
        key_version,
        updated_at
      )
      VALUES (${chainId}, ${project.id}, 1, ${recordHash}, 1, now())
    `;
    await tx`
      INSERT INTO app.audit_logs (
        chain_id,
        sequence_no,
        project_id,
        actor_type,
        actor_id,
        action,
        target_type,
        target_id,
        event_payload,
        request_id,
        client_request_id,
        ip_address,
        user_agent,
        occurred_at,
        prev_hash,
        record_hash,
        key_version,
        canonical_version
      )
      VALUES (
        ${chainId},
        1,
        ${project.id},
        'SYSTEM',
        NULL,
        'BACKUP_IT_SEED',
        'SYSTEM',
        NULL,
        ${JSON.stringify({ marker: "backup-integration" })}::jsonb,
        ${requestId},
        NULL,
        NULL,
        NULL,
        ${occurredAt.toISOString()}::timestamptz,
        ${prevHash},
        ${recordHash},
        1,
        'JCS-1'
      )
    `;
    await tx`
      INSERT INTO app.user_sessions (
        user_id,
        token_hash,
        token_hash_key_version,
        auth_version_at_issue,
        auth_state,
        idle_expires_at,
        absolute_expires_at
      )
      VALUES (
        ${user.id},
        ${tokenHash},
        1,
        1,
        'AUTHENTICATED',
        now() + interval '1 hour',
        now() + interval '12 hours'
      )
    `;
    await tx`
      INSERT INTO app.preauth_sessions (
        token_hash,
        token_hash_key_version,
        csrf_token_hash,
        expires_at
      )
      VALUES (
        ${tokenHash},
        1,
        ${csrfHash},
        now() + interval '5 minutes'
      )
    `;
    return {
      chainId,
      projectId: project.id,
      userId: user.id,
      recordHash: recordHash.toString("hex"),
    };
  });
}

beforeAll(async () => {
  baseUrl = required("TEST_DATABASE_URL");
  const migratorUrl = roleUrl(baseUrl, "app_migrator");
  backupUrl = roleUrl(baseUrl, "app_backup");
  await migrate(migratorUrl);

  const seeder = createDatabaseClient(migratorUrl, {
    applicationName: "inpulse-ops-backup-seed",
  });
  try {
    seed = await seedFixture(seeder);
  } finally {
    await seeder.close();
  }

  backupClient = createDatabaseClient(backupUrl, {
    applicationName: "inpulse-ops-backup-test",
    maxConnections: 2,
  });
});

afterAll(async () => {
  await backupClient?.close();
});

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterAll(async () => {
  await Promise.all(
    tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function withTempDatabase<T>(
  fn: (url: string) => Promise<T>,
): Promise<T> {
  const bootstrapUrl = roleUrl(baseUrl, "cluster_bootstrap");
  const admin = createDatabaseClient(bootstrapUrl, {
    applicationName: "inpulse-ops-backup-it-admin",
    maxConnections: 2,
  });
  const name = `inpulse_backup_it_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  try {
    await admin.sql.unsafe(`CREATE DATABASE ${name}`);
    try {
      return await fn(databaseUrlFor(bootstrapUrl, name));
    } finally {
      await admin.sql.unsafe(`DROP DATABASE ${name} WITH (FORCE)`);
    }
  } finally {
    await admin.close();
  }
}

describe("逻辑备份（真实 PostgreSQL + 真实 pg_dump + WORM 桩）", () => {
  test("app_backup 能锁定读取会话表结构但始终不能写入", async () => {
    const client = backupClient!;
    await expect(
      client.sql`SELECT count(*) FROM app.user_sessions`,
    ).resolves.toHaveLength(1);
    await expectPgError(client.sql`DELETE FROM app.user_sessions`, "42501");
    await expectPgError(
      client.sql`INSERT INTO app.session_csrf_tokens (session_id, token_hash, expires_at)
                SELECT id, decode(repeat('11', 32), 'hex'), now() + interval '1 hour' FROM app.user_sessions LIMIT 1`,
      "42501",
    );
  });

  test("runBackup 产出可解密包、签名清单与异机对象", async () => {
    const fixture = seed!;
    const dir = makeTempDir("inpulse-backup-run-");
    const config = backupConfig(dir);
    const stub = wormStub();
    const now = new Date("2042-06-07T08:09:10.000Z");

    const summary = await runBackup(config, {
      fetchImpl: stub.fetchImpl,
      now: () => now,
    });

    expect(summary.databaseName).toBe("app");
    expect(summary.databaseVersion).toMatch(/^18\./);
    expect(summary.migrationVersion).not.toBeNull();
    expect(summary.migrationVersion! >= "0007").toBe(true);
    expect(summary.plaintextBytes).toBeGreaterThan(1_000);
    expect(summary.objects).toHaveLength(2);

    const files = await readdir(dir);
    expect(files).toContain(summary.localFileName);
    expect(files).toContain(summary.manifestFileName);
    expect(files.some((name) => name.endsWith(".partial"))).toBe(false);

    const decrypted = await decryptBackupPackageFile(
      join(dir, summary.localFileName),
      keyring.keys,
    );
    expect(decrypted.plaintextSha256).toBe(summary.plaintextSha256);
    expect(decrypted.ciphertextBytes).toBe(summary.ciphertextBytes);

    const manifest = parseBackupManifest(
      await readFile(join(dir, summary.manifestFileName), "utf8"),
    );
    expect(() => verifyBackupManifest(manifest, keyring.keys)).not.toThrow();
    expect(manifest.payload.plaintextSha256).toBe(summary.plaintextSha256);
    expect(manifest.payload.ciphertextSha256).toBe(summary.ciphertextSha256);
    expect(manifest.payload.gitSha).toBe(config.gitSha);
    expect(manifest.payload.imageRef).toBe(config.imageRef);
    expect(manifest.payload.remoteRetentionDays).toBe(30);
    expect(manifest.payload.excludedTableData).toEqual([
      "app.user_sessions",
      "app.session_csrf_tokens",
      "app.preauth_sessions",
    ]);
    expect(
      manifest.payload.auditChainAnchors.some(
        (anchor) =>
          anchor.chainId === fixture.chainId &&
          anchor.lastHash === fixture.recordHash,
      ),
    ).toBe(true);

    expect(stub.puts.map((put) => put.key)).toEqual([
      summary.packageObjectKey,
      summary.manifestObjectKey,
    ]);
    expect(summary.packageObjectKey).toBe(
      `${PREFIX}/date=2042-06-07/${summary.localFileName}`,
    );
    const uploaded = stub.objects.get(summary.packageObjectKey);
    expect(uploaded).toBeDefined();
    expect(
      uploaded!.equals(await readFile(join(dir, summary.localFileName))),
    ).toBe(true);
  });

  test("恢复演练：TOC 保留会话表结构、排除会话数据，pg_restore 后会话表为空", async () => {
    const fixture = seed!;
    const dir = makeTempDir("inpulse-backup-restore-");
    const config = backupConfig(dir);
    const stub = wormStub();

    const summary = await runBackup(config, {
      fetchImpl: stub.fetchImpl,
      now: () => new Date("2042-06-07T08:09:10.000Z"),
    });

    // 恢复演练的明文只写入测试临时目录并在用例结束后清理；
    // 生产恢复流程必须在受限 tmpfs 中使用 decryptBackupPackageToFile。
    const plaintextPath = join(dir, "restore-input.pg_dump");
    const decrypted = await decryptBackupPackageToFile(
      join(dir, summary.localFileName),
      keyring.keys,
      plaintextPath,
    );
    expect(decrypted.plaintextSha256).toBe(summary.plaintextSha256);

    const listing = spawnSync(pgRestorePath(), ["--list", plaintextPath], {
      encoding: "utf8",
    });
    expect(listing.status).toBe(0);
    expect(listing.stdout).toContain("TABLE app user_sessions");
    expect(listing.stdout).toContain("TABLE app preauth_sessions");
    expect(listing.stdout).toContain("TABLE DATA app projects");
    expect(listing.stdout).not.toContain("TABLE DATA app user_sessions");
    expect(listing.stdout).not.toContain("TABLE DATA app session_csrf_tokens");
    expect(listing.stdout).not.toContain("TABLE DATA app preauth_sessions");

    await withTempDatabase(async (url) => {
      const restore = spawnSync(
        pgRestorePath(),
        [
          "--no-owner",
          "--no-acl",
          "--exit-on-error",
          "--dbname",
          url,
          plaintextPath,
        ],
        { encoding: "utf8" },
      );
      if (restore.status !== 0) {
        throw new Error(
          `pg_restore failed (status ${String(restore.status)}): ${restore.stderr}`,
        );
      }

      const checker = createDatabaseClient(url, {
        applicationName: "inpulse-ops-backup-it-checker",
        maxConnections: 2,
      });
      try {
        const [sessions] = (await checker.sql`
          SELECT count(*)::int AS "count" FROM app.user_sessions
        `) as unknown as readonly { readonly count: number }[];
        const [preauth] = (await checker.sql`
          SELECT count(*)::int AS "count" FROM app.preauth_sessions
        `) as unknown as readonly { readonly count: number }[];
        const [users] = (await checker.sql`
          SELECT count(*)::int AS "count" FROM app.users
        `) as unknown as readonly { readonly count: number }[];
        const [projects] = (await checker.sql`
          SELECT count(*)::int AS "count" FROM app.projects
        `) as unknown as readonly { readonly count: number }[];
        const [migrations] = (await checker.sql`
          SELECT count(*)::int AS "count" FROM app.schema_migrations
        `) as unknown as readonly { readonly count: number }[];
        expect(sessions!.count).toBe(0);
        expect(preauth!.count).toBe(0);
        expect(users!.count).toBeGreaterThanOrEqual(1);
        expect(projects!.count).toBeGreaterThanOrEqual(1);
        expect(migrations!.count).toBeGreaterThanOrEqual(8);

        const [restoredProject] = (await checker.sql`
          SELECT count(*)::int AS "count" FROM app.projects WHERE id = ${fixture.projectId}
        `) as unknown as readonly { readonly count: number }[];
        expect(restoredProject!.count).toBe(1);
      } finally {
        await checker.close();
      }
    });
  });
});
