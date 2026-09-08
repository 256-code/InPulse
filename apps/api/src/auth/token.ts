import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const OPAQUE_TOKEN_BYTES = 32;
export const OPAQUE_TOKEN_BASE64URL_LENGTH = 43;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** 生成 32 字节随机不透明令牌（base64url，无横线/下划线之外的字符）。 */
export function generateOpaqueToken(): string {
  return randomBytes(OPAQUE_TOKEN_BYTES).toString("base64url");
}

export function isValidOpaqueToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

/** 用版本化 HMAC-SHA-256 生成 32 字节令牌哈希；只存哈希，不明文落库。 */
export function hashOpaqueToken(token: string, key: Buffer): Buffer {
  if (!isValidOpaqueToken(token)) {
    throw new Error("opaque token must be exactly 43 base64url characters");
  }
  return createHmac("sha256", key).update(token, "utf8").digest();
}

/** 常量时间比较；长度不同快速返回 false，但不等长哈希比较不会泄漏内容。 */
export function constantTimeEqual(
  left: Uint8Array,
  right: Uint8Array,
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}
