import { spawn, type ChildProcess } from "node:child_process";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  type CipherGCM,
  type DecipherGCM,
  type Hash,
} from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  appendFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import {
  Readable,
  Transform,
  Writable,
  type TransformCallback,
} from "node:stream";
import { pipeline } from "node:stream/promises";

import { canonicalizeJson } from "@inpulse/canonical-json";
import { createDatabaseClient } from "@inpulse/database/client";

import type { AuditChainHead } from "./checkpoint.js";
import type { ArchiveSigningKeyring, BackupConfig } from "./config.js";
import {
  AUDIT_ARCHIVE_CANONICAL_VERSION,
  AUDIT_ARCHIVE_SIGNATURE_ALGORITHM,
  deriveBackupKey,
  GCM_TAG_LENGTH,
  signCanonicalJson,
  verifyCanonicalSignature,
} from "./crypto.js";
import { readChainHeads } from "./run.js";
import { WormClient, type WormPutResult } from "./worm.js";

/**
 * 逻辑备份服务本体（技术设计 v1.2.2 §11.5 / ADR-020，F-10.3）：
 *   pg_dump --format=custom（排除会话表数据）→ 管道内 AEAD 加密（AES-256-GCM，
 *   子密钥由备份密钥经 HKDF-SHA256 派生）→ 密文 SHA-256 与签名清单 →
 *   同文件系统原子重命名 → 异机对象存储（只新建、对象锁 >=30 天）。
 * 明文只存在于受限进程管道与临时密文文件之间，不生成任何本地明文最终文件。
 */

export const BACKUP_PACKAGE_MAGIC = "INPULSE-BACKUP-1";
export const BACKUP_PACKAGE_VERSION = 1;
export const BACKUP_PACKAGE_ALGORITHM = "AES-256-GCM";
export const BACKUP_PACKAGE_KDF = "HKDF-SHA256";
export const BACKUP_PG_DUMP_FORMAT = "custom";

/** pg_dump 排除数据（保留结构）的会话表清单，与迁移 0007 的注释保持一致。 */
export const BACKUP_EXCLUDED_TABLE_DATA = [
  "app.user_sessions",
  "app.session_csrf_tokens",
  "app.preauth_sessions",
] as const;

const BACKUP_SALT_LENGTH = 32;
const GCM_IV_LENGTH = 12;
const HEADER_SCAN_LIMIT = 65_536;
const PARTIAL_MAX_AGE_MS = 86_400_000;
const STDERR_LIMIT = 4_096;

export interface BackupPackageHeader {
  readonly kind: "BACKUP_PACKAGE";
  readonly version: typeof BACKUP_PACKAGE_VERSION;
  readonly algorithm: typeof BACKUP_PACKAGE_ALGORITHM;
  readonly kdf: typeof BACKUP_PACKAGE_KDF;
  readonly kdfInfo: "inpulse-backup-encryption-v1";
  readonly salt: string;
  readonly iv: string;
  readonly tagLength: number;
  readonly pgDumpFormat: typeof BACKUP_PG_DUMP_FORMAT;
  readonly createdAt: string;
  readonly signingKeyVersion: number;
}

export interface BackupAuditAnchor {
  readonly chainId: string;
  readonly projectId: number | null;
  readonly lastSequenceNo: number;
  readonly lastHash: string;
  readonly keyVersion: number;
  readonly headUpdatedAt: string;
}

export interface BackupMetadata {
  readonly databaseName: string;
  readonly databaseVersion: string;
  readonly migrationVersion: string | null;
  readonly chainAnchors: readonly BackupAuditAnchor[];
}

export interface BackupManifestPayload {
  readonly kind: "BACKUP_MANIFEST";
  readonly version: 1;
  readonly generatedAt: string;
  readonly databaseName: string;
  readonly databaseVersion: string;
  readonly migrationVersion: string | null;
  readonly imageRef: string | null;
  readonly gitSha: string | null;
  readonly pgDumpFormat: typeof BACKUP_PG_DUMP_FORMAT;
  readonly excludedTableData: readonly string[];
  readonly plaintextSha256: string;
  readonly plaintextBytes: number;
  readonly ciphertextSha256: string;
  readonly ciphertextBytes: number;
  readonly packageObjectKey: string;
  readonly manifestObjectKey: string;
  readonly localFileName: string;
  readonly localRetentionDays: number;
  readonly remoteRetentionDays: number | null;
  readonly uploadBucket: string;
  readonly auditChainAnchors: readonly BackupAuditAnchor[];
}

export interface BackupManifestEnvelope {
  readonly payload: BackupManifestPayload;
  readonly algorithm: typeof AUDIT_ARCHIVE_SIGNATURE_ALGORITHM;
  readonly canonicalVersion: typeof AUDIT_ARCHIVE_CANONICAL_VERSION;
  readonly signingKeyVersion: number;
  readonly signature: string;
}

export interface DecryptedBackupPackage {
  readonly header: BackupPackageHeader;
  readonly plaintextSha256: string;
  readonly plaintextBytes: number;
  readonly ciphertextSha256: string;
  readonly ciphertextBytes: number;
}

export interface PgDumpInvocation {
  readonly command: string;
  readonly args: readonly string[];
  /** 密码只经子进程环境注入，不出现在命令行参数中。 */
  readonly env: Readonly<Record<string, string>>;
}
/**
 * 组装 pg_dump 调用：连接串里的密码拆出到 `PGPASSWORD`，命令参数与日志
 * 不出现凭据；排除清单与 `--format=custom --no-owner --no-acl` 固定。
 */
export function buildPgDumpInvocation(
  pgDumpPath: string,
  databaseUrl: string,
  excludedTables: readonly string[] = BACKUP_EXCLUDED_TABLE_DATA,
): PgDumpInvocation {
  const url = new URL(databaseUrl);
  const password = decodeURIComponent(url.password);
  url.password = "";
  const args = [
    "--format=custom",
    "--no-owner",
    "--no-acl",
    ...excludedTables.map((table) => `--exclude-table-data=${table}`),
    `--dbname=${url.toString()}`,
  ];
  return {
    command: pgDumpPath,
    args,
    env: password.length > 0 ? { PGPASSWORD: password } : {},
  };
}

function compactTimestamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

/** 对象键：`<prefix>/date=<YYYY-MM-DD>/<fileName>`（独立于审计归档的对象前缀）。 */
export function backupObjectKey(
  prefix: string,
  generatedAt: Date,
  fileName: string,
): string {
  const date = generatedAt.toISOString().slice(0, 10);
  return `${prefix}/date=${date}/${fileName}`;
}

export function buildBackupPackageHeader(options: {
  readonly createdAt: Date;
  readonly salt: Buffer;
  readonly iv: Buffer;
  readonly signingKeyVersion: number;
}): BackupPackageHeader {
  return {
    kind: "BACKUP_PACKAGE",
    version: BACKUP_PACKAGE_VERSION,
    algorithm: BACKUP_PACKAGE_ALGORITHM,
    kdf: BACKUP_PACKAGE_KDF,
    kdfInfo: "inpulse-backup-encryption-v1",
    salt: options.salt.toString("base64url"),
    iv: options.iv.toString("base64url"),
    tagLength: GCM_TAG_LENGTH,
    pgDumpFormat: BACKUP_PG_DUMP_FORMAT,
    createdAt: options.createdAt.toISOString(),
    signingKeyVersion: options.signingKeyVersion,
  };
}

export function encodeBackupPackageHeader(header: BackupPackageHeader): Buffer {
  return Buffer.from(`${canonicalizeJson(header)}\n`, "utf8");
}

/** 解析包前缀（magic 行 + header 行）；返回密文起始偏移。 */
export function parseBackupPackageHeaderPrefix(prefix: Buffer): {
  readonly header: BackupPackageHeader;
  readonly ciphertextOffset: number;
} {
  const firstBreak = prefix.indexOf(0x0a);
  if (firstBreak < 0) {
    throw new Error("backup package is missing the magic line");
  }
  if (
    prefix.subarray(0, firstBreak).toString("utf8") !== BACKUP_PACKAGE_MAGIC
  ) {
    throw new Error("backup package magic mismatch");
  }
  const secondBreak = prefix.indexOf(0x0a, firstBreak + 1);
  if (secondBreak < 0) {
    throw new Error("backup package is missing the header line");
  }
  const headerText = prefix
    .subarray(firstBreak + 1, secondBreak)
    .toString("utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(headerText);
  } catch {
    throw new Error("backup package header is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("backup package header must be an object");
  }
  const candidate = parsed as Record<string, unknown>;
  if (
    candidate["kind"] !== "BACKUP_PACKAGE" ||
    candidate["version"] !== BACKUP_PACKAGE_VERSION ||
    candidate["algorithm"] !== BACKUP_PACKAGE_ALGORITHM ||
    candidate["kdf"] !== BACKUP_PACKAGE_KDF ||
    candidate["kdfInfo"] !== "inpulse-backup-encryption-v1" ||
    candidate["pgDumpFormat"] !== BACKUP_PG_DUMP_FORMAT
  ) {
    throw new Error("backup package header is not supported");
  }
  return {
    header: candidate as unknown as BackupPackageHeader,
    ciphertextOffset: secondBreak + 1,
  };
}

export function createBackupEncryptor(
  encryptionKey: Buffer,
  salt: Buffer,
  iv: Buffer,
): CipherGCM {
  return createCipheriv(
    "aes-256-gcm",
    deriveBackupKey(encryptionKey, salt),
    iv,
  );
}

export function createBackupDecryptor(
  encryptionKey: Buffer,
  salt: Buffer,
  iv: Buffer,
): DecipherGCM {
  return createDecipheriv(
    "aes-256-gcm",
    deriveBackupKey(encryptionKey, salt),
    iv,
  );
}

/** 透传流：更新哈希（可选统计字节数），数据原样传递。 */
class HashingPassthrough extends Transform {
  constructor(
    private readonly hash: Hash,
    private readonly counter?: (chunkLength: number) => void,
  ) {
    super();
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    this.hash.update(chunk);
    this.counter?.(chunk.length);
    callback(null, chunk);
  }
}

/**
 * 解密备份包到指定文件（恢复流程）。调用方必须保证目标在受限 tmpfs；
 * 文件以 0600 创建且不覆盖已有文件（与备份服务不产生本地明文最终文件的红线一致）。
 */
export async function decryptBackupPackageToFile(
  sourcePath: string,
  keys: ReadonlyMap<number, Buffer>,
  outPath: string,
): Promise<DecryptedBackupPackage> {
  const output = createWriteStream(outPath, { flags: "wx", mode: 0o600 });
  try {
    return await decryptBackupPackageCore(sourcePath, keys, output);
  } catch (error) {
    await rm(outPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** 解密备份包并校验 AEAD 认证标签与密文/明文字节统计；
 * 返回明文 SHA-256 与字节数，供清单校验与恢复流程使用（明文不落盘）。
 */
export async function decryptBackupPackageFile(
  filePath: string,
  keys: ReadonlyMap<number, Buffer>,
): Promise<DecryptedBackupPackage> {
  const sink = new Writable({
    write(_chunk: Buffer, _encoding: BufferEncoding, callback): void {
      callback();
    },
  });
  return decryptBackupPackageCore(filePath, keys, sink);
}

async function decryptBackupPackageCore(
  filePath: string,
  keys: ReadonlyMap<number, Buffer>,
  output: Writable,
): Promise<DecryptedBackupPackage> {
  const handle = await open(filePath, "r");
  let prefix: Buffer;
  let fileSize: number;
  let tag: Buffer;
  try {
    const info = await handle.stat();
    fileSize = info.size;
    if (fileSize < GCM_TAG_LENGTH) {
      throw new Error("backup package is truncated");
    }
    const buffer = Buffer.alloc(HEADER_SCAN_LIMIT);
    const { bytesRead } = await handle.read(buffer, 0, HEADER_SCAN_LIMIT, 0);
    prefix = buffer.subarray(0, bytesRead);
    tag = Buffer.alloc(GCM_TAG_LENGTH);
    // 认证标签固定位于文件末尾（ciphertext || tag，与加密端一致）。
    await handle.read(tag, 0, GCM_TAG_LENGTH, fileSize - GCM_TAG_LENGTH);
  } finally {
    await handle.close();
  }
  const { header, ciphertextOffset } = parseBackupPackageHeaderPrefix(prefix);
  if (fileSize - ciphertextOffset < GCM_TAG_LENGTH) {
    throw new Error("backup package ciphertext is truncated");
  }
  const key = keys.get(header.signingKeyVersion);
  if (key === undefined) {
    throw new Error(`no backup key for version ${header.signingKeyVersion}`);
  }
  const decipher = createBackupDecryptor(
    key,
    Buffer.from(header.salt, "base64url"),
    Buffer.from(header.iv, "base64url"),
  );
  decipher.setAuthTag(tag);
  const plaintextHash = createHash("sha256");
  const ciphertextHash = createHash("sha256");
  let plaintextBytes = 0;
  const bodyBytes = fileSize - ciphertextOffset - GCM_TAG_LENGTH;
  const bodyStream =
    bodyBytes > 0
      ? createReadStream(filePath, {
          start: ciphertextOffset,
          end: fileSize - GCM_TAG_LENGTH - 1,
        })
      : Readable.from([]);
  await pipeline(
    bodyStream,
    new HashingPassthrough(ciphertextHash),
    decipher,
    new HashingPassthrough(plaintextHash, (length) => {
      plaintextBytes += length;
    }),
    output,
  );
  ciphertextHash.update(tag);
  return {
    header,
    plaintextSha256: plaintextHash.digest("hex"),
    plaintextBytes,
    ciphertextSha256: ciphertextHash.digest("hex"),
    ciphertextBytes: fileSize - ciphertextOffset,
  };
}
export function buildBackupManifest(
  payload: Omit<BackupManifestPayload, "kind" | "version">,
  signingKeyring: ArchiveSigningKeyring,
): BackupManifestEnvelope {
  const key = signingKeyring.keys.get(signingKeyring.currentVersion);
  if (key === undefined) {
    throw new Error("backup keyring has no current key");
  }
  const fullPayload: BackupManifestPayload = {
    kind: "BACKUP_MANIFEST",
    version: 1,
    ...payload,
  };
  return {
    payload: fullPayload,
    algorithm: AUDIT_ARCHIVE_SIGNATURE_ALGORITHM,
    canonicalVersion: AUDIT_ARCHIVE_CANONICAL_VERSION,
    signingKeyVersion: signingKeyring.currentVersion,
    signature: signCanonicalJson(fullPayload, key),
  };
}

export function encodeBackupManifest(envelope: BackupManifestEnvelope): Buffer {
  return Buffer.from(`${canonicalizeJson(envelope)}\n`, "utf8");
}

export function parseBackupManifest(text: string): BackupManifestEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("backup manifest is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("backup manifest must be a JSON object");
  }
  const envelope = parsed as Record<string, unknown>;
  if (envelope["algorithm"] !== AUDIT_ARCHIVE_SIGNATURE_ALGORITHM) {
    throw new Error("backup manifest algorithm must be HMAC-SHA256");
  }
  if (envelope["canonicalVersion"] !== AUDIT_ARCHIVE_CANONICAL_VERSION) {
    throw new Error("backup manifest canonicalVersion must be JCS-1");
  }
  const payload = envelope["payload"];
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    throw new Error("backup manifest payload is missing");
  }
  return envelope as unknown as BackupManifestEnvelope;
}

export function verifyBackupManifest(
  envelope: BackupManifestEnvelope,
  keys: ReadonlyMap<number, Buffer>,
): void {
  const key = keys.get(envelope.signingKeyVersion);
  if (key === undefined) {
    throw new Error(`no backup key for version ${envelope.signingKeyVersion}`);
  }
  if (!verifyCanonicalSignature(envelope.payload, key, envelope.signature)) {
    throw new Error("backup manifest signature verification failed");
  }
  if (envelope.payload.kind !== "BACKUP_MANIFEST") {
    throw new Error("backup manifest kind mismatch");
  }
}

/**
 * 本机保留清理：删除超过保留天数的本机密文与清单，并清理超过 24 小时的
 * 中断残留 `.partial` 文件；返回删除的文件名清单。
 */
export async function cleanupLocalBackups(
  localDir: string,
  retentionDays: number,
  now: Date,
): Promise<string[]> {
  const removed: string[] = [];
  const cutoff = now.getTime() - retentionDays * 86_400_000;
  const partialCutoff = now.getTime() - PARTIAL_MAX_AGE_MS;
  const entries = await readdir(localDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const name = entry.name;
    const isPackage = /^backup-.*\.pgdump\.enc$/.test(name);
    const isManifest = /^backup-.*\.pgdump\.enc\.manifest\.json$/.test(name);
    const isPartial = name.startsWith("backup-") && name.endsWith(".partial");
    if (!isPackage && !isManifest && !isPartial) {
      continue;
    }
    const path = join(localDir, name);
    const info = await stat(path);
    const expired = isPartial
      ? info.mtimeMs < partialCutoff
      : info.mtimeMs < cutoff;
    if (expired) {
      await unlink(path);
      removed.push(name);
    }
  }
  return removed;
}

/** 读取备份清单所需的数据库元数据与审计链锚点（只读，app_backup 角色）。 */
export async function collectBackupMetadata(
  databaseUrl: string,
): Promise<BackupMetadata> {
  const client = createDatabaseClient(databaseUrl, {
    applicationName: "inpulse-ops-backup",
    maxConnections: 2,
  });
  try {
    const rows = (await client.sql`
      SELECT current_database() AS "databaseName",
             current_setting('server_version') AS "databaseVersion"
    `) as unknown as readonly {
      readonly databaseName: string;
      readonly databaseVersion: string;
    }[];
    const row = rows[0];
    if (row === undefined) {
      throw new Error("backup metadata query returned no row");
    }
    const migrations = (await client.sql`
      SELECT name FROM app.schema_migrations ORDER BY name DESC LIMIT 1
    `) as unknown as readonly { readonly name: string }[];
    const heads: readonly AuditChainHead[] = await readChainHeads(client.sql);
    return {
      databaseName: row.databaseName,
      databaseVersion: row.databaseVersion,
      migrationVersion: migrations[0]?.name ?? null,
      chainAnchors: heads.map((head) => ({
        chainId: head.chainId,
        projectId: head.projectId,
        lastSequenceNo: head.lastSequenceNo,
        lastHash: head.lastHash,
        keyVersion: head.keyVersion,
        headUpdatedAt: head.headUpdatedAt,
      })),
    };
  } finally {
    await client.close();
  }
}

export interface BackupDependencies {
  readonly spawnImpl?: typeof spawn;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly collectMetadata?: (databaseUrl: string) => Promise<BackupMetadata>;
}

export interface BackupRunSummary {
  readonly mode: "backup";
  readonly generatedAt: string;
  readonly databaseName: string;
  readonly databaseVersion: string;
  readonly migrationVersion: string | null;
  readonly plaintextSha256: string;
  readonly plaintextBytes: number;
  readonly ciphertextSha256: string;
  readonly ciphertextBytes: number;
  readonly localFileName: string;
  readonly manifestFileName: string;
  readonly packageObjectKey: string;
  readonly manifestObjectKey: string;
  readonly objects: readonly WormPutResult[];
  readonly removedLocalFiles: readonly string[];
}
/** 执行一次加密逻辑备份：pg_dump → 管道内加密 → 可解密校验 → 原子重命名 → 异机上传。 */
export async function runBackup(
  config: BackupConfig,
  deps: BackupDependencies = {},
): Promise<BackupRunSummary> {
  const generatedAt = deps.now?.() ?? new Date();
  const spawnImpl = deps.spawnImpl ?? spawn;
  const collectMetadata = deps.collectMetadata ?? collectBackupMetadata;

  await mkdir(config.localDir, { recursive: true });
  const removedLocalFiles = await cleanupLocalBackups(
    config.localDir,
    config.localRetentionDays,
    generatedAt,
  );

  const metadata = await collectMetadata(config.databaseUrl);

  const key = config.keyring.keys.get(config.keyring.currentVersion);
  if (key === undefined) {
    throw new Error("backup keyring has no current key");
  }

  const salt = randomBytes(BACKUP_SALT_LENGTH);
  const iv = randomBytes(GCM_IV_LENGTH);
  const cipher = createBackupEncryptor(key, salt, iv);
  const header = buildBackupPackageHeader({
    createdAt: generatedAt,
    salt,
    iv,
    signingKeyVersion: config.keyring.currentVersion,
  });

  const plaintextHash = createHash("sha256");
  const ciphertextHash = createHash("sha256");
  let plaintextBytes = 0;

  const stamp = compactTimestamp(generatedAt);
  const partialPath = join(
    config.localDir,
    `backup-${stamp}-${randomBytes(4).toString("hex")}.pgdump.enc.partial`,
  );

  const invocation = buildPgDumpInvocation(
    config.pgDumpPath,
    config.databaseUrl,
  );
  const child: ChildProcess = spawnImpl(
    invocation.command,
    [...invocation.args],
    {
      env: { ...process.env, ...invocation.env },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let stderrText = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    if (stderrText.length < STDERR_LIMIT) {
      stderrText += chunk.toString("utf8");
    }
  });

  const exitPromise = new Promise<{
    readonly code: number | null;
    readonly signal: NodeJS.Signals | null;
  }>((resolve) => {
    child.on("error", () => resolve({ code: null, signal: null }));
    child.on("close", (code, signal) => resolve({ code, signal }));
  });

  try {
    if (child.stdout === null) {
      throw new Error(`failed to spawn ${invocation.command}`);
    }
    // 临时文件与最终文件同目录：rename 才具备同文件系统原子性。
    const output = createWriteStream(partialPath, { flags: "wx" });
    output.write(Buffer.from(`${BACKUP_PACKAGE_MAGIC}\n`, "utf8"));
    output.write(encodeBackupPackageHeader(header));
    await pipeline(
      child.stdout,
      new HashingPassthrough(plaintextHash, (length) => {
        plaintextBytes += length;
      }),
      cipher,
      new HashingPassthrough(ciphertextHash),
      output,
    );
    const tag = cipher.getAuthTag();
    ciphertextHash.update(tag);
    await appendFile(partialPath, tag);

    const exit = await exitPromise;
    if (exit.code !== 0) {
      throw new Error(
        `pg_dump exited with code ${String(exit.code)}${
          stderrText.trim().length > 0 ? `: ${stderrText.trim()}` : ""
        }`,
      );
    }

    // 红线（技术设计 §11.5 第 3 步）：确认可解密读取后才生成密文 SHA-256 与签名清单。
    const verified = await decryptBackupPackageFile(
      partialPath,
      config.keyring.keys,
    );
    const plaintextSha256 = plaintextHash.digest("hex");
    if (verified.plaintextSha256 !== plaintextSha256) {
      throw new Error("backup verification plaintext hash mismatch");
    }
    if (verified.plaintextBytes !== plaintextBytes) {
      throw new Error("backup verification plaintext size mismatch");
    }
    const ciphertextSha256 = ciphertextHash.digest("hex");
    if (verified.ciphertextSha256 !== ciphertextSha256) {
      throw new Error("backup verification ciphertext hash mismatch");
    }

    const syncHandle = await open(partialPath, "r+");
    try {
      await syncHandle.sync();
    } finally {
      await syncHandle.close();
    }

    const fileName = `backup-${stamp}-${ciphertextSha256.slice(0, 12)}.pgdump.enc`;
    const finalPath = join(config.localDir, fileName);
    await rename(partialPath, finalPath);

    const packageKey = backupObjectKey(
      config.upload.prefix,
      generatedAt,
      fileName,
    );
    const manifestKey = `${packageKey}.manifest.json`;
    const manifest = buildBackupManifest(
      {
        generatedAt: generatedAt.toISOString(),
        databaseName: metadata.databaseName,
        databaseVersion: metadata.databaseVersion,
        migrationVersion: metadata.migrationVersion,
        imageRef: config.imageRef,
        gitSha: config.gitSha,
        pgDumpFormat: BACKUP_PG_DUMP_FORMAT,
        excludedTableData: [...BACKUP_EXCLUDED_TABLE_DATA],
        plaintextSha256,
        plaintextBytes,
        ciphertextSha256,
        ciphertextBytes: verified.ciphertextBytes,
        packageObjectKey: packageKey,
        manifestObjectKey: manifestKey,
        localFileName: fileName,
        localRetentionDays: config.localRetentionDays,
        remoteRetentionDays: config.upload.objectLock?.retainDays ?? null,
        uploadBucket: config.upload.bucket,
        auditChainAnchors: metadata.chainAnchors,
      },
      config.keyring,
    );
    const manifestBytes = encodeBackupManifest(manifest);
    const manifestFileName = `${fileName}.manifest.json`;
    await writeFile(join(config.localDir, manifestFileName), manifestBytes, {
      flag: "wx",
    });

    const worm = new WormClient(config.upload, {
      ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
      ...(deps.sleep === undefined ? {} : { sleep: deps.sleep }),
      ...(deps.now === undefined ? {} : { now: deps.now }),
      timeoutMs: config.fetchTimeoutMs,
    });
    const objects: WormPutResult[] = [];
    objects.push(
      await worm.putObject(
        packageKey,
        await readFile(finalPath),
        "application/octet-stream",
      ),
    );
    objects.push(
      await worm.putObject(manifestKey, manifestBytes, "application/json"),
    );

    return {
      mode: "backup",
      generatedAt: generatedAt.toISOString(),
      databaseName: metadata.databaseName,
      databaseVersion: metadata.databaseVersion,
      migrationVersion: metadata.migrationVersion,
      plaintextSha256,
      plaintextBytes,
      ciphertextSha256,
      ciphertextBytes: verified.ciphertextBytes,
      localFileName: fileName,
      manifestFileName,
      packageObjectKey: packageKey,
      manifestObjectKey: manifestKey,
      objects,
      removedLocalFiles,
    };
  } catch (error) {
    await unlink(partialPath).catch(() => undefined);
    if (child.exitCode === null && child.signalCode === null) {
      try {
        child.kill("SIGKILL");
      } catch {
        // spawn 失败或进程已退出：没有可终止的子进程。
      }
    }
    throw error;
  }
}
