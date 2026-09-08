import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { IdempotencyFingerprintKeyring } from "../src/idempotency/keyring";

describe("IdempotencyFingerprintKeyring", () => {
  test("缺少版本或文件时 fail closed", () => {
    expect(
      () => new IdempotencyFingerprintKeyring({}).currentVersion,
    ).toThrow();
    expect(
      () =>
        new IdempotencyFingerprintKeyring({
          IDEMPOTENCY_FINGERPRINT_KEY_VERSION: "1",
        }).currentVersion,
    ).toThrow();
  });

  test("拒绝 /run/secrets 之外的路径与非法版本", () => {
    expect(
      () =>
        new IdempotencyFingerprintKeyring({
          IDEMPOTENCY_FINGERPRINT_KEY_VERSION: "1",
          IDEMPOTENCY_FINGERPRINT_KEYRING_FILE: "./secrets/keyring",
        }).currentVersion,
    ).toThrow();
    expect(
      () =>
        new IdempotencyFingerprintKeyring({
          IDEMPOTENCY_FINGERPRINT_KEY_VERSION: "not-a-number",
          IDEMPOTENCY_FINGERPRINT_KEYRING_FILE: "/run/secrets/keyring",
        }).currentVersion,
    ).toThrow();
  });

  test("测试环境必须显式选择临时 keyring，否则仍 fail closed", async () => {
    const directory = await mkdtemp(join(tmpdir(), "inpulse-idempotency-"));
    const file = join(directory, "fingerprint.keyring");
    await writeFile(file, `1:${"ab".repeat(32)}\n`, "utf8");
    try {
      expect(
        () =>
          new IdempotencyFingerprintKeyring({
            NODE_ENV: "test",
            IDEMPOTENCY_FINGERPRINT_KEY_VERSION: "1",
            IDEMPOTENCY_FINGERPRINT_KEYRING_FILE: file,
          }).currentVersion,
      ).toThrow();

      const keyring = new IdempotencyFingerprintKeyring({
        NODE_ENV: "test",
        IDEMPOTENCY_FINGERPRINT_KEY_VERSION: "1",
        IDEMPOTENCY_FINGERPRINT_KEYRING_FILE: file,
        IDEMPOTENCY_FINGERPRINT_KEYRING_TEST_PATH: "1",
      });
      expect(keyring.currentVersion).toBe(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
