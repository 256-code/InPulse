import { readFileSync } from "node:fs";

import { parseHmacKeyringFile, VersionedHmacKeyring } from "../auth/keyring.js";

const KEY_VERSION_ENV = "IDEMPOTENCY_FINGERPRINT_KEY_VERSION";
const KEYRING_FILE_ENV = "IDEMPOTENCY_FINGERPRINT_KEYRING_FILE";

/**
 * 幂等请求摘要专用版本化密钥。加载延迟到首次使用时执行，
 * 避免阶段 0 尚无 idempotencyRequired 路由时阻断匿名健康探针；
 * 一旦真正执行幂等命令，缺失/空/越界/版本不存在均 fail closed。
 */
export class IdempotencyFingerprintKeyring {
  private loaded: VersionedHmacKeyring | undefined;

  constructor(
    private readonly env: Readonly<Record<string, string | undefined>>,
  ) {}

  get currentVersion(): number {
    return this.load().currentVersion;
  }

  currentKey(): Buffer {
    return this.load().currentKey();
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
