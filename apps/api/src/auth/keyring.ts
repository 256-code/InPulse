import { readFileSync } from "node:fs";

/** 一个非敏感版本号到至少 32 字节 HMAC 密钥的映射。 */
export interface HmacKeyringEntry {
  readonly version: number;
  readonly key: Buffer;
}

const KEYRING_ENTRY = /^([1-9][0-9]*)\s*:\s*([0-9a-fA-F]{64,})\s*$/;
const KEYRING_COMMENT = /^\s*#/;
const MIN_KEY_BYTES = 32;

function toBuffer(value: string | Buffer): Buffer {
  if (Buffer.isBuffer(value)) {
    return value;
  }
  if (!/^[0-9a-fA-F]{64,}$/.test(value)) {
    throw new Error(
      "HMAC keyring key must be a hex string of at least 64 characters",
    );
  }
  return Buffer.from(value, "hex");
}

function validateEntries(
  entries: readonly HmacKeyringEntry[],
  currentVersion: number,
): ReadonlyMap<number, Buffer> {
  if (!Number.isInteger(currentVersion) || currentVersion <= 0) {
    throw new Error("current HMAC key version must be a positive integer");
  }
  if (entries.length === 0) {
    throw new Error("HMAC keyring must contain at least one key");
  }

  const keys = new Map<number, Buffer>();
  for (const entry of entries) {
    if (!Number.isInteger(entry.version) || entry.version <= 0) {
      throw new Error("HMAC keyring version must be a positive integer");
    }
    if (keys.has(entry.version)) {
      throw new Error(`duplicate HMAC keyring version ${entry.version}`);
    }
    if (entry.key.length < MIN_KEY_BYTES) {
      throw new Error(
        `HMAC keyring version ${entry.version} must be at least ${MIN_KEY_BYTES} bytes`,
      );
    }
    keys.set(entry.version, entry.key);
  }

  if (!keys.has(currentVersion)) {
    throw new Error(
      `HMAC keyring has no key for current version ${currentVersion}`,
    );
  }
  return keys;
}

export function parseHmacKeyringFile(
  content: string,
): readonly HmacKeyringEntry[] {
  const entries: HmacKeyringEntry[] = [];
  const lines = content.split(/\r?\n/);
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (line.length === 0 || KEYRING_COMMENT.test(line)) {
      continue;
    }
    const match = KEYRING_ENTRY.exec(line);
    if (match === null) {
      throw new Error(`invalid HMAC keyring entry at line ${index + 1}`);
    }
    entries.push({
      version: Number.parseInt(match[1]!, 10),
      key: toBuffer(match[2]!),
    });
  }
  return entries;
}

/**
 * 版本化 HMAC keyring（技术设计 §7/保密基线）：`version:hexkey` 每行一项，
 * `#` 行与空行忽略。当前版本由非敏感 selector 选择，缺失/为空/版本不存在
 * 或密钥不足 32 字节时 fail closed；生产路径只允许 `/run/secrets/*`，
 * 不提供敏感环境变量值 fallback。
 */
export class VersionedHmacKeyring {
  readonly currentVersion: number;
  private readonly keys: ReadonlyMap<number, Buffer>;

  private constructor(
    entries: readonly HmacKeyringEntry[],
    currentVersion: number,
  ) {
    this.currentVersion = currentVersion;
    this.keys = validateEntries(entries, currentVersion);
  }

  static fromEntries(
    entries: readonly HmacKeyringEntry[],
    currentVersion: number,
  ): VersionedHmacKeyring {
    return new VersionedHmacKeyring(entries, currentVersion);
  }

  static fromEnv(
    env: Readonly<Record<string, string | undefined>>,
  ): VersionedHmacKeyring {
    const versionRaw = env["SESSION_HASH_KEY_VERSION"]?.trim();
    const fileRaw = env["SESSION_HASH_KEYRING_FILE"]?.trim();
    if (!versionRaw) {
      throw new Error(
        "SESSION_HASH_KEY_VERSION is required and must be a positive integer",
      );
    }
    const currentVersion = Number.parseInt(versionRaw, 10);
    if (!Number.isInteger(currentVersion) || currentVersion <= 0) {
      throw new Error("SESSION_HASH_KEY_VERSION must be a positive integer");
    }
    if (!fileRaw) {
      throw new Error("SESSION_HASH_KEYRING_FILE is required");
    }
    if (!fileRaw.startsWith("/run/secrets/")) {
      throw new Error("SESSION_HASH_KEYRING_FILE must be under /run/secrets/");
    }
    const content = readFileSync(fileRaw, "utf8");
    return VersionedHmacKeyring.fromEntries(
      parseHmacKeyringFile(content),
      currentVersion,
    );
  }

  keyFor(version: number): Buffer {
    const key = this.keys.get(version);
    if (key === undefined) {
      throw new Error(`HMAC keyring does not contain version ${version}`);
    }
    return key;
  }

  currentKey(): Buffer {
    return this.keyFor(this.currentVersion);
  }
}
