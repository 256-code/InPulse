import { readFileSync } from "node:fs";

/** 一个非敏感版本号到至少 32 字节 TOTP KEK 的映射。 */
export interface AeadKeyringEntry {
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
    throw new Error("TOTP KEK must be a hex string of at least 64 characters");
  }
  return Buffer.from(value, "hex");
}

function validateEntries(
  entries: readonly AeadKeyringEntry[],
  currentVersion: number,
): ReadonlyMap<number, Buffer> {
  if (!Number.isInteger(currentVersion) || currentVersion <= 0) {
    throw new Error("current TOTP KEK version must be a positive integer");
  }
  if (entries.length === 0) {
    throw new Error("TOTP KEK keyring must contain at least one key");
  }

  const keys = new Map<number, Buffer>();
  for (const entry of entries) {
    if (!Number.isInteger(entry.version) || entry.version <= 0) {
      throw new Error("TOTP KEK version must be a positive integer");
    }
    if (keys.has(entry.version)) {
      throw new Error(`duplicate TOTP KEK version ${entry.version}`);
    }
    if (entry.key.length < MIN_KEY_BYTES) {
      throw new Error(
        `TOTP KEK version ${entry.version} must be at least ${MIN_KEY_BYTES} bytes`,
      );
    }
    keys.set(entry.version, entry.key);
  }

  if (!keys.has(currentVersion)) {
    throw new Error(
      `TOTP KEK keyring has no key for current version ${currentVersion}`,
    );
  }
  return keys;
}

export function parseAeadKeyringFile(
  content: string,
): readonly AeadKeyringEntry[] {
  const entries: AeadKeyringEntry[] = [];
  const lines = content.split(/\r?\n/);
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (line.length === 0 || KEYRING_COMMENT.test(line)) {
      continue;
    }
    const match = KEYRING_ENTRY.exec(line);
    if (match === null) {
      throw new Error(`invalid TOTP KEK keyring entry at line ${index + 1}`);
    }
    entries.push({
      version: Number.parseInt(match[1]!, 10),
      key: toBuffer(match[2]!),
    });
  }
  return entries;
}

/**
 * 版本化 TOTP AEAD keyring。TOTP Secret 使用独立 keK 加密，生产路径只允许
 * `/run/secrets/*`，缺失、为空、版本不存在或密钥不足 32 字节时 fail closed，
 * 不提供敏感环境变量值 fallback。
 */
export class VersionedAeadKeyring {
  readonly currentVersion: number;
  readonly versions: readonly number[];
  private readonly keys: ReadonlyMap<number, Buffer>;

  private constructor(
    entries: readonly AeadKeyringEntry[],
    currentVersion: number,
  ) {
    this.currentVersion = currentVersion;
    this.keys = validateEntries(entries, currentVersion);
    this.versions = [...this.keys.keys()].sort((left, right) => left - right);
  }

  static fromEntries(
    entries: readonly AeadKeyringEntry[],
    currentVersion: number,
  ): VersionedAeadKeyring {
    return new VersionedAeadKeyring(entries, currentVersion);
  }

  static fromEnv(
    env: Readonly<Record<string, string | undefined>>,
  ): VersionedAeadKeyring {
    const versionRaw = env["TOTP_KEK_VERSION"]?.trim();
    const fileRaw = env["TOTP_KEK_KEYRING_FILE"]?.trim();
    if (!versionRaw) {
      throw new Error(
        "TOTP_KEK_VERSION is required and must be a positive integer",
      );
    }
    const currentVersion = Number.parseInt(versionRaw, 10);
    if (!Number.isInteger(currentVersion) || currentVersion <= 0) {
      throw new Error("TOTP_KEK_VERSION must be a positive integer");
    }
    if (!fileRaw) {
      throw new Error("TOTP_KEK_KEYRING_FILE is required");
    }
    const allowTestPath =
      env["NODE_ENV"] === "test" && env["TOTP_KEK_KEYRING_TEST_PATH"] === "1";
    if (!allowTestPath && !fileRaw.startsWith("/run/secrets/")) {
      throw new Error("TOTP_KEK_KEYRING_FILE must be under /run/secrets/");
    }
    const content = readFileSync(fileRaw, "utf8");
    return VersionedAeadKeyring.fromEntries(
      parseAeadKeyringFile(content),
      currentVersion,
    );
  }

  keyFor(version: number): Buffer {
    const key = this.keys.get(version);
    if (key === undefined) {
      throw new Error(`TOTP KEK keyring does not contain version ${version}`);
    }
    return key;
  }

  currentKey(): Buffer {
    return this.keyFor(this.currentVersion);
  }
}
