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
});
