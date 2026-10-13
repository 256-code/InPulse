import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

const KEYRING_ENTRY = /^([1-9][0-9]*)\s*:\s*([0-9a-fA-F]{64,})\s*$/;
const KEYRING_COMMENT = /^\s*#/;
/** AES-256 主密钥长度（字节）。 */
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
/** GCM 附加认证数据：恒定绑定到表与列（ADR-068）。 */
const AAD = Buffer.from("app.ai_assist_settings.api_key", "utf8");

/** 主密钥不可用（文件缺失 / 非法 / 缺版本）；HTTP 层 fail closed。 */
export class AiAssistEncryptionUnavailableError extends Error {
  constructor(readonly reason: string) {
    super(`AI assist encryption key unavailable: ${reason}`);
    this.name = "AiAssistEncryptionUnavailableError";
  }
}

/** 密文解密失败（GCM 校验不通过）；按配置非法处理。 */
export class AiAssistDecryptError extends Error {
  constructor() {
    super("AI assist secret ciphertext failed authentication");
    this.name = "AiAssistDecryptError";
  }
}

export interface AiAssistEncryptionKeyring {
  readonly currentVersion: number;
  readonly keys: ReadonlyMap<number, Buffer>;
}

export function parseAiAssistEncryptionKeyring(
  content: string,
  currentVersion: number,
): AiAssistEncryptionKeyring {
  if (!Number.isInteger(currentVersion) || currentVersion <= 0) {
    throw new AiAssistEncryptionUnavailableError("current key version invalid");
  }
  const keys = new Map<number, Buffer>();
  const lines = content.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0 || KEYRING_COMMENT.test(line)) {
      continue;
    }
    const match = KEYRING_ENTRY.exec(line);
    if (match === null) {
      throw new AiAssistEncryptionUnavailableError("keyring entry invalid");
    }
    const version = Number.parseInt(match[1]!, 10);
    const key = Buffer.from(match[2]!, "hex");
    if (key.length < KEY_BYTES) {
      throw new AiAssistEncryptionUnavailableError("keyring key too short");
    }
    if (keys.has(version)) {
      throw new AiAssistEncryptionUnavailableError("duplicate keyring version");
    }
    keys.set(version, key);
  }
  if (keys.size === 0) {
    throw new AiAssistEncryptionUnavailableError("keyring is empty");
  }
  if (!keys.has(currentVersion)) {
    throw new AiAssistEncryptionUnavailableError("current key version missing");
  }
  return { currentVersion, keys };
}

/**
 * 从环境变量加载主密钥 keyring（ADR-068）：文件路径必须指向
 * `/run/secrets/*` 直接子项；仅 `NODE_ENV=test` 且显式设置
 * `AI_ASSIST_ENCRYPTION_KEY_TEST_PATH=1` 时允许临时路径。
 * 任何失败都抛 AiAssistEncryptionUnavailableError（fail closed，不回退）。
 */
export function loadAiAssistEncryptionKeyring(
  env: Readonly<Record<string, string | undefined>>,
): AiAssistEncryptionKeyring {
  const filePath = env["AI_ASSIST_ENCRYPTION_KEY_FILE"]?.trim();
  if (filePath === undefined || filePath.length === 0) {
    throw new AiAssistEncryptionUnavailableError(
      "AI_ASSIST_ENCRYPTION_KEY_FILE is required",
    );
  }
  const allowTestPath =
    env["NODE_ENV"] === "test" &&
    env["AI_ASSIST_ENCRYPTION_KEY_TEST_PATH"] === "1";
  if (!allowTestPath && !filePath.startsWith("/run/secrets/")) {
    throw new AiAssistEncryptionUnavailableError(
      "AI_ASSIST_ENCRYPTION_KEY_FILE must be under /run/secrets/",
    );
  }
  const versionRaw = env["AI_ASSIST_ENCRYPTION_KEY_VERSION"]?.trim();
  const currentVersion =
    versionRaw === undefined || versionRaw.length === 0
      ? 1
      : Number.parseInt(versionRaw, 10);
  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    throw new AiAssistEncryptionUnavailableError(
      "AI_ASSIST_ENCRYPTION_KEY_FILE is not readable",
    );
  }
  return parseAiAssistEncryptionKeyring(content, currentVersion);
}

/** 加密密钥明文；返回 `nonce || tag || ciphertext` 与主密钥版本。 */
export function encryptAiAssistSecret(
  plaintext: string,
  keyring: AiAssistEncryptionKeyring,
): { readonly ciphertext: Buffer; readonly keyVersion: number } {
  const key = keyring.keys.get(keyring.currentVersion);
  if (key === undefined) {
    throw new AiAssistEncryptionUnavailableError("current key version missing");
  }
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(AAD);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([nonce, tag, encrypted]),
    keyVersion: keyring.currentVersion,
  };
}

/** 解密密钥明文；未知主密钥版本与 GCM 校验失败都抛错（fail closed）。 */
export function decryptAiAssistSecret(
  ciphertext: Buffer,
  keyVersion: number,
  keyring: AiAssistEncryptionKeyring,
): string {
  const key = keyring.keys.get(keyVersion);
  if (key === undefined) {
    throw new AiAssistEncryptionUnavailableError("keyring version missing");
  }
  if (ciphertext.length < NONCE_BYTES + TAG_BYTES + 1) {
    throw new AiAssistDecryptError();
  }
  const nonce = ciphertext.subarray(0, NONCE_BYTES);
  const tag = ciphertext.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES);
  const body = ciphertext.subarray(NONCE_BYTES + TAG_BYTES);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(body),
      decipher.final(),
    ]).toString("utf8");
    if (plaintext.length === 0) {
      throw new AiAssistDecryptError();
    }
    return plaintext;
  } catch (error) {
    if (error instanceof AiAssistDecryptError) {
      throw error;
    }
    throw new AiAssistDecryptError();
  }
}

/** 密钥尾 4 位提示；短于 4 位时整体作为提示。 */
export function aiAssistKeyHint(apiKey: string): string {
  return apiKey.slice(-4);
}
