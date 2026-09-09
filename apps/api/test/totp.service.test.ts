import { randomBytes } from "node:crypto";

import { describe, expect, test } from "vitest";

import { TotpService, TOTP_ISSUER } from "../src/auth/totp.service.js";
import { VersionedAeadKeyring } from "../src/auth/totp-keyring.js";

function makeService() {
  const keyring = VersionedAeadKeyring.fromEntries(
    [{ version: 1, key: randomBytes(32) }],
    1,
  );
  return new TotpService(keyring);
}

describe("TotpService", () => {
  test("生成 20 字节 Base32 Secret，每次随机", () => {
    const service = makeService();
    const first = service.generateSecretBase32();
    const second = service.generateSecretBase32();

    expect(first).toMatch(/^[A-Z2-7]{32}$/);
    expect(second).toMatch(/^[A-Z2-7]{32}$/);
    expect(first).not.toBe(second);
  });

  test("AES-256-GCM 加解密往返，密文不含明文", () => {
    const service = makeService();
    const secret = service.generateSecretBase32();
    const encrypted = service.encryptSecret(secret);

    expect(encrypted.keyVersion).toBe(1);
    expect(encrypted.nonce).toHaveLength(12);
    expect(encrypted.authTag).toHaveLength(16);
    expect(encrypted.ciphertext.toString("base64")).not.toContain(secret);
    expect(service.decryptSecret(encrypted)).toBe(secret);
  });

  test("接受 RFC 6238 SHA-1/30s/6 位标准向量并拒绝同 step 重放", () => {
    const service = makeService();
    const rfcSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

    expect(service.verifyCode(rfcSecret, "287082", 59_000, null)).toBe(1);
    expect(
      service.verifyCode(rfcSecret, "081804", 1_111_111_109_000, null),
    ).toBe(37_037_036);
    expect(
      service.verifyCode(rfcSecret, "050471", 1_111_111_111_000, null),
    ).toBe(37_037_037);
    expect(service.verifyCode(rfcSecret, "287082", 59_000, 1)).toBeUndefined();
    expect(
      service.verifyCode(rfcSecret, "000000", 59_000, null),
    ).toBeUndefined();
  });

  test("生成 otpauth URI 且只包含允许参数", () => {
    const service = makeService();
    const secret = service.generateSecretBase32();
    const uri = service.buildOtpauthUri(secret, 42);

    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain(`issuer=${encodeURIComponent(TOTP_ISSUER)}`);
    expect(uri).toContain(`secret=${secret.toUpperCase()}`);
    expect(uri).toContain("algorithm=SHA1&digits=6&period=30");
  });
});
