import { randomBytes } from "node:crypto";

import { describe, expect, test } from "vitest";

import {
  decryptAuditExport,
  deriveExportKey,
  encryptAuditExport,
  hmacSha256Hex,
  sha256Hex,
  signCanonicalJson,
  verifyCanonicalSignature,
} from "../src/crypto.js";

const key = randomBytes(32);

describe("归档签名", () => {
  test("字段顺序不影响签名，输入变化会改变签名", () => {
    const first = signCanonicalJson({ b: 2, a: { z: 1, y: 2 } }, key);
    const second = signCanonicalJson({ a: { y: 2, z: 1 }, b: 2 }, key);
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(signCanonicalJson({ a: { y: 2, z: 1 }, b: 3 }, key)).not.toBe(first);
  });

  test("验签通过且拒绝篡改与错误密钥", () => {
    const payload = { kind: "TEST", value: "中文 payload" };
    const signature = signCanonicalJson(payload, key);
    expect(verifyCanonicalSignature(payload, key, signature)).toBe(true);
    expect(
      verifyCanonicalSignature(
        { kind: "TEST", value: "tampered" },
        key,
        signature,
      ),
    ).toBe(false);
    expect(verifyCanonicalSignature(payload, randomBytes(32), signature)).toBe(
      false,
    );
    expect(verifyCanonicalSignature(payload, key, "not-hex")).toBe(false);
  });
});

describe("导出加密", () => {
  test("HKDF 派生稳定且随 salt 变化", () => {
    const salt = randomBytes(32);
    expect(deriveExportKey(key, salt).equals(deriveExportKey(key, salt))).toBe(
      true,
    );
    expect(
      deriveExportKey(key, randomBytes(32)).equals(deriveExportKey(key, salt)),
    ).toBe(false);
  });

  test("AES-256-GCM 往返一致", () => {
    const plaintext = Buffer.from("chain 1 second-line 中文", "utf8");
    const encrypted = encryptAuditExport(plaintext, key);
    expect(encrypted.plaintextSha256).toBe(sha256Hex(plaintext));
    const decrypted = decryptAuditExport(
      encrypted.ciphertext,
      key,
      encrypted.iv,
      encrypted.salt,
    );
    expect(decrypted.equals(plaintext)).toBe(true);
  });

  test("篡改密文或使用错误密钥解密失败", () => {
    const encrypted = encryptAuditExport(Buffer.from("secret"), key);
    const tampered = Buffer.from(encrypted.ciphertext);
    tampered[0] = (tampered[0] ?? 0) ^ 0xff;
    expect(() =>
      decryptAuditExport(tampered, key, encrypted.iv, encrypted.salt),
    ).toThrow();
    expect(() =>
      decryptAuditExport(
        encrypted.ciphertext,
        randomBytes(32),
        encrypted.iv,
        encrypted.salt,
      ),
    ).toThrow();
  });

  test("hmacSha256Hex 输出稳定", () => {
    expect(hmacSha256Hex(key, "payload")).toBe(hmacSha256Hex(key, "payload"));
    expect(hmacSha256Hex(key, "payload")).toHaveLength(64);
  });
});
