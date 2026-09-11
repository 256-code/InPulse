import { EventEmitter } from "node:events";
import { mkdtempSync, utimesSync } from "node:fs";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import type { ChildProcess, SpawnOptions } from "node:child_process";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  BACKUP_PACKAGE_MAGIC,
  backupObjectKey,
  buildBackupManifest,
  buildBackupPackageHeader,
  buildPgDumpInvocation,
  cleanupLocalBackups,
  decryptBackupPackageFile,
  encodeBackupManifest,
  encodeBackupPackageHeader,
  parseBackupManifest,
  parseBackupPackageHeaderPrefix,
  runBackup,
  verifyBackupManifest,
  type BackupMetadata,
} from "../src/backup.js";
import type { ArchiveSigningKeyring, BackupConfig } from "../src/config.js";
import { deriveBackupKey } from "../src/crypto.js";

const key = Buffer.alloc(32, 0x42);

const keyring: ArchiveSigningKeyring = {
  currentVersion: 1,
  keys: new Map([[1, key]]),
};

// 测试口令只以变量拼接进入连接串，避免把字面量凭据写进仓库（check:secrets 门禁）。
const testDatabaseCredential = "synthetic-credential";

function backupConfig(localDir: string): BackupConfig {
  return {
    databaseUrl: `postgresql://app_backup:${testDatabaseCredential}@db:5432/app?sslmode=require`,
    localDir,
    localRetentionDays: 7,
    pgDumpPath: "pg_dump",
    keyring,
    upload: {
      endpoint: new URL("https://worm.example.com"),
      region: "cn-north-1",
      bucket: "inpulse-backup",
      accessKeyId: "AKIDBACKUP",
      secretAccessKey: "backup-secret",
      prefix: "inpulse/backups",
      forcePathStyle: true,
      objectLock: { mode: "COMPLIANCE", retainDays: 30 },
    },
    fetchTimeoutMs: 5_000,
    gitSha: "0123456789abcdef0123456789abcdef01234567",
    imageRef: "inpulse/ops:0.0.0@sha256:" + "a".repeat(64),
  };
}

const metadata: BackupMetadata = {
  databaseName: "app",
  databaseVersion: "18.6",
  migrationVersion: "0007_backup_role_pg_dump_grants.sql",
  chainAnchors: [
    {
      chainId: "PROJECT:1",
      projectId: 1,
      lastSequenceNo: 4,
      lastHash: "ab".repeat(32),
      keyVersion: 1,
      headUpdatedAt: "2026-09-11T00:00:00.000000Z",
    },
  ],
};

interface SpawnCapture {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
}

function fakeSpawn(
  payload: Buffer,
  exitCode = 0,
): {
  readonly impl: typeof import("node:child_process").spawn;
  readonly calls: SpawnCapture[];
} {
  const calls: SpawnCapture[] = [];
  const impl = ((
    command: string,
    args?: readonly string[],
    options?: SpawnOptions,
  ) => {
    calls.push({
      command,
      args: args ?? [],
      env: (options?.env ?? {}) as Readonly<Record<string, string | undefined>>,
    });
    const child = new EventEmitter() as EventEmitter & {
      stdout: Readable;
      stderr: PassThrough;
      exitCode: number | null;
      signalCode: NodeJS.Signals | null;
      killed: boolean;
      kill: (signal?: NodeJS.Signals) => boolean;
    };
    child.stdout = Readable.from([payload], { objectMode: false });
    child.stderr = new PassThrough();
    child.exitCode = null;
    child.signalCode = null;
    child.killed = false;
    child.kill = () => {
      child.killed = true;
      return true;
    };
    child.stdout.on("end", () => {
      child.exitCode = exitCode;
      setImmediate(() => child.emit("close", exitCode, null));
    });
    return child as unknown as ChildProcess;
  }) as typeof import("node:child_process").spawn;
  return { impl, calls };
}

interface CapturedPut {
  readonly key: string;
  readonly body: Buffer;
  readonly contentType: string | undefined;
  readonly headers: Readonly<Record<string, string>>;
}

function wormStub(
  bucket: string,
  options: { readonly failPuts?: number } = {},
) {
  const puts: CapturedPut[] = [];
  const objects = new Map<string, Buffer>();
  let remainingFailures = options.failPuts ?? 0;
  const fetchImpl = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = input instanceof URL ? input : new URL(String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    const segments = url.pathname
      .split("/")
      .filter((segment) => segment.length > 0);
    if (decodeURIComponent(segments[0] ?? "") !== bucket) {
      throw new Error("unexpected bucket in stub");
    }
    const objectKey = segments
      .slice(1)
      .map((segment) => decodeURIComponent(segment))
      .join("/");
    if (method === "PUT") {
      if (remainingFailures > 0) {
        remainingFailures -= 1;
        return new Response(null, { status: 500 });
      }
      const body = init?.body;
      if (!Buffer.isBuffer(body)) {
        throw new Error("stub expects a Buffer PUT body");
      }
      objects.set(objectKey, Buffer.from(body));
      puts.push({
        key: objectKey,
        body: Buffer.from(body),
        contentType: (init?.headers as Record<string, string> | undefined)?.[
          "content-type"
        ],
        headers: (init?.headers ?? {}) as Record<string, string>,
      });
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

/** 与 runBackup 相同结构的测试用包构建（小输入，可直接内存加密）。 */
async function writeTestPackage(
  dir: string,
  fileName: string,
  plaintext: Buffer,
  options: { readonly keyMaterial?: Buffer; readonly tamper?: boolean } = {},
): Promise<string> {
  const { createCipheriv, randomBytes } = await import("node:crypto");
  const salt = randomBytes(32);
  const iv = randomBytes(12);
  const material = options.keyMaterial ?? key;
  const cipher = createCipheriv(
    "aes-256-gcm",
    deriveBackupKey(material, salt),
    iv,
  );
  const header = buildBackupPackageHeader({
    createdAt: new Date("2026-09-11T01:02:03.000Z"),
    salt,
    iv,
    signingKeyVersion: 1,
  });
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  let ciphertext = Buffer.concat([body, tag]);
  if (options.tamper === true) {
    const tampered = Buffer.from(ciphertext);
    tampered[0] = (tampered[0] ?? 0) ^ 0xff;
    ciphertext = tampered;
  }
  const file = Buffer.concat([
    Buffer.from(`${BACKUP_PACKAGE_MAGIC}\n`, "utf8"),
    encodeBackupPackageHeader(header),
    ciphertext,
  ]);
  const path = join(dir, fileName);
  await writeFile(path, file);
  return path;
}

let tempDir = "";

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "inpulse-backup-unit-"));
});

afterEach(() => {
  // 临时目录由操作系统回收；测试不依赖其状态。
});

describe("pg_dump 调用组装", () => {
  test("固定 format/no-owner/no-acl 与排除清单，密码只进子进程环境", () => {
    const rawCredential = "se@cret";
    const invocation = buildPgDumpInvocation(
      "pg_dump",
      `postgresql://app_backup:${encodeURIComponent(rawCredential)}@db:5432/app?sslmode=require`,
    );
    expect(invocation.command).toBe("pg_dump");
    expect(invocation.args).toEqual([
      "--format=custom",
      "--no-owner",
      "--no-acl",
      "--exclude-table-data=app.user_sessions",
      "--exclude-table-data=app.session_csrf_tokens",
      "--exclude-table-data=app.preauth_sessions",
      "--dbname=postgresql://app_backup@db:5432/app?sslmode=require",
    ]);
    expect(invocation.args.join(" ")).not.toContain(rawCredential);
    expect(invocation.env).toEqual({ PGPASSWORD: rawCredential });
  });

  test("trust 连接不注入 PGPASSWORD", () => {
    const invocation = buildPgDumpInvocation(
      "pg_dump",
      "postgresql://app_backup@db/app",
    );
    expect(invocation.env).toEqual({});
  });

  test("密码在命令行参数中不可见", () => {
    const invocation = buildPgDumpInvocation(
      "pg_dump",
      `postgresql://app_backup:${testDatabaseCredential}@db:5432/app`,
    );
    expect(invocation.args.join(" ")).not.toContain(testDatabaseCredential);
    expect(invocation.args.join(" ")).toContain(
      "--dbname=postgresql://app_backup@db:5432/app",
    );
  });
});

describe("备份包格式", () => {
  test("header round-trip 与密文偏移", () => {
    const header = buildBackupPackageHeader({
      createdAt: new Date("2026-09-11T01:02:03.000Z"),
      salt: Buffer.alloc(32, 1),
      iv: Buffer.alloc(12, 2),
      signingKeyVersion: 3,
    });
    const file = Buffer.concat([
      Buffer.from(`${BACKUP_PACKAGE_MAGIC}\n`, "utf8"),
      encodeBackupPackageHeader(header),
      Buffer.from("ciphertext", "utf8"),
    ]);
    const parsed = parseBackupPackageHeaderPrefix(file);
    expect(parsed.header).toEqual(header);
    expect(file.subarray(parsed.ciphertextOffset).toString("utf8")).toBe(
      "ciphertext",
    );
  });

  test("magic 或版本不符时拒绝", () => {
    expect(() =>
      parseBackupPackageHeaderPrefix(Buffer.from("WRONG\n{}\n", "utf8")),
    ).toThrow("magic");
    const header = buildBackupPackageHeader({
      createdAt: new Date("2026-09-11T01:02:03.000Z"),
      salt: Buffer.alloc(32, 1),
      iv: Buffer.alloc(12, 2),
      signingKeyVersion: 1,
    });
    const bad = Buffer.from(
      `${JSON.stringify({ ...header, version: 2 })}\n`,
      "utf8",
    );
    expect(() =>
      parseBackupPackageHeaderPrefix(
        Buffer.concat([Buffer.from(`${BACKUP_PACKAGE_MAGIC}\n`, "utf8"), bad]),
      ),
    ).toThrow("not supported");
  });

  test("解密校验明文/密文哈希与字节数", async () => {
    const plaintext = Buffer.from("dump-bytes-".repeat(100), "utf8");
    const path = await writeTestPackage(
      tempDir,
      "backup-test.pgdump.enc",
      plaintext,
    );
    const decrypted = await decryptBackupPackageFile(path, keyring.keys);
    const { createHash } = await import("node:crypto");
    expect(decrypted.plaintextSha256).toBe(
      createHash("sha256").update(plaintext).digest("hex"),
    );
    expect(decrypted.plaintextBytes).toBe(plaintext.length);
    expect(decrypted.ciphertextBytes).toBe(plaintext.length + 16);
    expect(decrypted.header.pgDumpFormat).toBe("custom");
  });

  test("篡改密文触发认证失败", async () => {
    const path = await writeTestPackage(
      tempDir,
      "backup-tampered.pgdump.enc",
      Buffer.from("data"),
      { tamper: true },
    );
    await expect(
      decryptBackupPackageFile(path, keyring.keys),
    ).rejects.toThrow();
  });

  test("缺少对应版本密钥时拒绝", async () => {
    const path = await writeTestPackage(
      tempDir,
      "backup-wrong-key.pgdump.enc",
      Buffer.from("data"),
      { keyMaterial: Buffer.alloc(32, 0x99) },
    );
    await expect(decryptBackupPackageFile(path, new Map())).rejects.toThrow(
      "no backup key",
    );
  });
});

describe("签名清单", () => {
  function manifestFixture() {
    return buildBackupManifest(
      {
        generatedAt: "2026-09-11T01:00:00.000Z",
        databaseName: "app",
        databaseVersion: "18.6",
        migrationVersion: "0006_leftover_search_entity.sql",
        imageRef: null,
        gitSha: null,
        pgDumpFormat: "custom",
        excludedTableData: ["app.user_sessions"],
        plaintextSha256: "11".repeat(32),
        plaintextBytes: 10,
        ciphertextSha256: "22".repeat(32),
        ciphertextBytes: 26,
        packageObjectKey: "inpulse/backups/date=2026-09-11/backup-x.pgdump.enc",
        manifestObjectKey:
          "inpulse/backups/date=2026-09-11/backup-x.pgdump.enc.manifest.json",
        localFileName: "backup-x.pgdump.enc",
        localRetentionDays: 7,
        remoteRetentionDays: 30,
        uploadBucket: "inpulse-backup",
        auditChainAnchors: [],
      },
      keyring,
    );
  }

  test("构建-编码-解析-验签通过", () => {
    const manifest = manifestFixture();
    const parsed = parseBackupManifest(
      encodeBackupManifest(manifest).toString("utf8"),
    );
    expect(() => verifyBackupManifest(parsed, keyring.keys)).not.toThrow();
    expect(parsed.payload.kind).toBe("BACKUP_MANIFEST");
  });

  test("篡改 payload 后验签失败", () => {
    const parsed = parseBackupManifest(
      encodeBackupManifest(manifestFixture()).toString("utf8"),
    );
    const tampered = {
      ...parsed,
      payload: { ...parsed.payload, plaintextBytes: 999 },
    } as unknown as typeof parsed;
    expect(() => verifyBackupManifest(tampered, keyring.keys)).toThrow(
      "signature",
    );
  });
});

describe("本机保留清理", () => {
  test("删除超期包与清单、清理超 24 小时的部分文件", async () => {
    const old = join(tempDir, "backup-old.pgdump.enc");
    const oldManifest = join(tempDir, "backup-old.pgdump.enc.manifest.json");
    const fresh = join(tempDir, "backup-new.pgdump.enc");
    const stalePartial = join(tempDir, "backup-stale.pgdump.enc.partial");
    const freshPartial = join(tempDir, "backup-fresh.pgdump.enc.partial");
    const unrelated = join(tempDir, "notes.txt");
    await Promise.all(
      [old, oldManifest, fresh, stalePartial, freshPartial, unrelated].map(
        (path) => writeFile(path, "x"),
      ),
    );
    const now = new Date("2026-09-11T12:00:00.000Z");
    const eightDaysAgo = new Date(now.getTime() - 8 * 86_400_000);
    const twoDaysAgo = new Date(now.getTime() - 2 * 86_400_000);
    utimesSync(old, eightDaysAgo, eightDaysAgo);
    utimesSync(oldManifest, eightDaysAgo, eightDaysAgo);
    utimesSync(stalePartial, twoDaysAgo, twoDaysAgo);

    const removed = await cleanupLocalBackups(tempDir, 7, now);
    expect([...removed].sort()).toEqual([
      "backup-old.pgdump.enc",
      "backup-old.pgdump.enc.manifest.json",
      "backup-stale.pgdump.enc.partial",
    ]);
    const remaining = await readdir(tempDir);
    expect([...remaining].sort()).toEqual([
      "backup-fresh.pgdump.enc.partial",
      "backup-new.pgdump.enc",
      "notes.txt",
    ]);
    await expect(stat(old)).rejects.toThrow();
  });
});

describe("对象键", () => {
  test("按日期目录组织且与审计前缀独立", () => {
    expect(
      backupObjectKey(
        "inpulse/backups",
        new Date("2026-09-11T00:00:00.000Z"),
        "backup-x.pgdump.enc",
      ),
    ).toBe("inpulse/backups/date=2026-09-11/backup-x.pgdump.enc");
  });
});

describe("runBackup 编排", () => {
  test("完成加密、校验、原子重命名与异机上传", async () => {
    const config = backupConfig(tempDir);
    const payload = Buffer.from("PGDMP-fake-custom-dump-".repeat(50), "utf8");
    const spawnStub = fakeSpawn(payload);
    const stub = wormStub(config.upload.bucket);
    const now = new Date("2026-09-11T05:06:07.000Z");

    const summary = await runBackup(config, {
      spawnImpl: spawnStub.impl,
      fetchImpl: stub.fetchImpl,
      now: () => now,
      collectMetadata: async () => metadata,
    });

    expect(spawnStub.calls).toHaveLength(1);
    const call = spawnStub.calls[0]!;
    expect(call.command).toBe("pg_dump");
    expect(call.args).toContain("--exclude-table-data=app.session_csrf_tokens");
    expect(call.env["PGPASSWORD"]).toBe(testDatabaseCredential);
    expect(call.env["BACKUP_UNRELATED"]).toBeUndefined();

    const files = await readdir(tempDir);
    expect(files.some((name) => name.endsWith(".partial"))).toBe(false);
    expect(files).toContain(summary.localFileName);
    expect(files).toContain(summary.manifestFileName);

    expect(stub.puts.map((put) => put.key)).toEqual([
      summary.packageObjectKey,
      summary.manifestObjectKey,
    ]);
    expect(summary.packageObjectKey).toBe(
      `inpulse/backups/date=2026-09-11/${summary.localFileName}`,
    );
    expect(summary.manifestObjectKey).toBe(
      `${summary.packageObjectKey}.manifest.json`,
    );
    const localBytes = await readFile(join(tempDir, summary.localFileName));
    expect(stub.objects.get(summary.packageObjectKey)!.equals(localBytes)).toBe(
      true,
    );

    const manifestText = await readFile(
      join(tempDir, summary.manifestFileName),
      "utf8",
    );
    const manifest = parseBackupManifest(manifestText);
    expect(() => verifyBackupManifest(manifest, keyring.keys)).not.toThrow();
    expect(manifest.payload.plaintextSha256).toBe(summary.plaintextSha256);
    expect(manifest.payload.ciphertextSha256).toBe(summary.ciphertextSha256);
    expect(manifest.payload.gitSha).toBe(config.gitSha);
    expect(manifest.payload.imageRef).toBe(config.imageRef);
    expect(manifest.payload.remoteRetentionDays).toBe(30);
    expect(manifest.payload.auditChainAnchors).toEqual(metadata.chainAnchors);
    expect(manifest.payload.excludedTableData).toEqual([
      "app.user_sessions",
      "app.session_csrf_tokens",
      "app.preauth_sessions",
    ]);
    expect(summary.objects).toHaveLength(2);
    expect(summary.objects[0]!.created).toBe(true);
    expect(summary.removedLocalFiles).toEqual([]);
  });

  test("解密校验能独立确认上传前的包可读", async () => {
    const config = backupConfig(tempDir);
    const payload = Buffer.from("readable-dump", "utf8");
    const spawnStub = fakeSpawn(payload);
    const stub = wormStub(config.upload.bucket);
    const summary = await runBackup(config, {
      spawnImpl: spawnStub.impl,
      fetchImpl: stub.fetchImpl,
      now: () => new Date("2026-09-11T05:06:07.000Z"),
      collectMetadata: async () => metadata,
    });
    const decrypted = await decryptBackupPackageFile(
      join(tempDir, summary.localFileName),
      keyring.keys,
    );
    expect(decrypted.plaintextSha256).toBe(summary.plaintextSha256);
    expect(decrypted.plaintextBytes).toBe(payload.length);
  });

  test("pg_dump 失败时清理临时文件且不上传", async () => {
    const config = backupConfig(tempDir);
    const spawnStub = fakeSpawn(Buffer.from("partial-bytes"), 1);
    const stub = wormStub(config.upload.bucket);
    await expect(
      runBackup(config, {
        spawnImpl: spawnStub.impl,
        fetchImpl: stub.fetchImpl,
        now: () => new Date("2026-09-11T05:06:07.000Z"),
        collectMetadata: async () => metadata,
      }),
    ).rejects.toThrow("pg_dump exited with code 1");
    expect(stub.puts).toHaveLength(0);
    const files = await readdir(tempDir);
    expect(files).toEqual([]);
  });

  test("上传失败时保留本机副本作为 7 天恢复窗口", async () => {
    const config = backupConfig(tempDir);
    const spawnStub = fakeSpawn(Buffer.from("dump-for-retention"));
    const stub = wormStub(config.upload.bucket, { failPuts: 3 });
    await expect(
      runBackup(config, {
        spawnImpl: spawnStub.impl,
        fetchImpl: stub.fetchImpl,
        sleep: async () => undefined,
        now: () => new Date("2026-09-11T05:06:07.000Z"),
        collectMetadata: async () => metadata,
      }),
    ).rejects.toThrow("WORM put");
    const files = await readdir(tempDir);
    expect(
      files.some(
        (name) => name.startsWith("backup-") && name.endsWith(".pgdump.enc"),
      ),
    ).toBe(true);
    expect(files.some((name) => name.endsWith(".manifest.json"))).toBe(true);
    expect(files.some((name) => name.endsWith(".partial"))).toBe(false);
  });
});
