import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  createHash,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { canonicalizeJson } from "@inpulse/canonical-json";

/** 归档签名与审计哈希链共用同一规范化版本。 */
export const AUDIT_ARCHIVE_CANONICAL_VERSION = "JCS-1";
export const AUDIT_ARCHIVE_SIGNATURE_ALGORITHM = "HMAC-SHA256";
/** 导出密文的 HKDF 派生上下文；变更派生输入必须同时升级导出包 version。 */
export const AUDIT_EXPORT_KDF_INFO = "inpulse-audit-export-v1";

const EXPORT_KEY_LENGTH = 32;
const GCM_IV_LENGTH = 12;
export const GCM_TAG_LENGTH = 16;
const EXPORT_SALT_LENGTH = 32;

export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function hmacSha256Hex(key: Buffer, data: Buffer | string): string {
  return createHmac("sha256", key).update(data).digest("hex");
}

/** 对 JCS 规范化后的 payload 求 HMAC-SHA-256，返回 64 位十六进制。 */
export function signCanonicalJson(payload: unknown, key: Buffer): string {
  return hmacSha256Hex(key, canonicalizeJson(payload));
}

/** 常量时间比较签名（长度不一致直接失败）。 */
export function verifyCanonicalSignature(
  payload: unknown,
  key: Buffer,
  signatureHex: string,
): boolean {
  if (!/^[0-9a-f]{64}$/.test(signatureHex)) return false;
  const expected = Buffer.from(
    hmacSha256Hex(key, canonicalizeJson(payload)),
    "hex",
  );
  const actual = Buffer.from(signatureHex, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** 归档导出与备份加密各自使用独立的 HKDF info；跨用途复用子密钥属于违规。 */
export function deriveSubkey(
  masterKey: Buffer,
  salt: Buffer,
  info: string,
): Buffer {
  return Buffer.from(
    hkdfSync("sha256", masterKey, salt, info, EXPORT_KEY_LENGTH),
  );
}

/** 导出加密子密钥（info `inpulse-audit-export-v1`）。 */
export function deriveExportKey(signingKey: Buffer, salt: Buffer): Buffer {
  return deriveSubkey(signingKey, salt, AUDIT_EXPORT_KDF_INFO);
}

/** 逻辑备份加密子密钥（info `inpulse-backup-encryption-v1`，与导出用途分离）。 */
export const BACKUP_ENCRYPTION_KDF_INFO = "inpulse-backup-encryption-v1";

export function deriveBackupKey(encryptionKey: Buffer, salt: Buffer): Buffer {
  return deriveSubkey(encryptionKey, salt, BACKUP_ENCRYPTION_KDF_INFO);
}

export interface EncryptedExport {
  /** AES-256-GCM 密文与 16 字节认证标签拼接（ciphertext || tag）。 */
  readonly ciphertext: Buffer;
  readonly iv: Buffer;
  readonly salt: Buffer;
  readonly plaintextSha256: string;
}

export function encryptAuditExport(
  plaintext: Buffer,
  signingKey: Buffer,
): EncryptedExport {
  const salt = randomBytes(EXPORT_SALT_LENGTH);
  const iv = randomBytes(GCM_IV_LENGTH);
  const key = deriveExportKey(signingKey, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([body, tag]),
    iv,
    salt,
    plaintextSha256: sha256Hex(plaintext),
  };
}

export function decryptAuditExport(
  ciphertext: Buffer,
  signingKey: Buffer,
  iv: Buffer,
  salt: Buffer,
): Buffer {
  if (ciphertext.length < GCM_TAG_LENGTH) {
    throw new Error("audit export ciphertext is truncated");
  }
  const tag = ciphertext.subarray(ciphertext.length - GCM_TAG_LENGTH);
  const body = ciphertext.subarray(0, ciphertext.length - GCM_TAG_LENGTH);
  const key = deriveExportKey(signingKey, salt);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}
