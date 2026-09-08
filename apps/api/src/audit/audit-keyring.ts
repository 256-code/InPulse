import { readFileSync } from "node:fs";

import { parseHmacKeyringFile, VersionedHmacKeyring } from "../auth/keyring.js";

const KEY_VERSION_ENV = "AUDIT_HMAC_KEY_VERSION";
const KEYRING_FILE_ENV = "AUDIT_HMAC_KEYRING_FILE";

/** 审计 HMAC 密钥提供者：当前版本号与按版本取密钥。 */
export interface AuditKeyProvider {
  readonly currentVersion: number;
  keyFor(version: number): Buffer;
}

/**
 * 按保密基线从 `/run/secrets/*` 惰性加载审计 HMAC keyring。
 * 与 `IdempotencyFingerprintKeyring` 同构：仅在首次真正写审计时读取，
 * 缺失/空/越界/版本不存在均 fail closed；生产路径不提供敏感环境变量回退。
 */
export class AuditHmacKeyring implements AuditKeyProvider {
  private loaded: VersionedHmacKeyring | undefined;

  constructor(
    private readonly env: Readonly<Record<string, string | undefined>>,
  ) {}

  get currentVersion(): number {
    return this.load().currentVersion;
  }

  keyFor(version: number): Buffer {
    return this.load().keyFor(version);
  }

  private load(): VersionedHmacKeyring {
    if (this.loaded !== undefined) {
      return this.loaded;
    }
    const versionRaw = this.env[KEY_VERSION_ENV]?.trim();
    const fileRaw = this.env[KEYRING_FILE_ENV]?.trim();
    if (!versionRaw) {
      throw new Error(`${KEY_VERSION_ENV} is required`);
    }
    const currentVersion = Number.parseInt(versionRaw, 10);
    if (!Number.isInteger(currentVersion) || currentVersion <= 0) {
      throw new Error(`${KEY_VERSION_ENV} must be a positive integer`);
    }
    if (!fileRaw) {
      throw new Error(`${KEYRING_FILE_ENV} is required`);
    }
    if (!fileRaw.startsWith("/run/secrets/")) {
      throw new Error(`${KEYRING_FILE_ENV} must be under /run/secrets/`);
    }
    this.loaded = VersionedHmacKeyring.fromEntries(
      parseHmacKeyringFile(readFileSync(fileRaw, "utf8")),
      currentVersion,
    );
    return this.loaded;
  }
}
