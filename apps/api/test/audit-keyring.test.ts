import { describe, expect, test } from "vitest";

import { AuditHmacKeyring } from "../src/audit/audit-keyring";

describe("AuditHmacKeyring", () => {
  test("缺少版本或文件时 fail closed", () => {
    expect(() => new AuditHmacKeyring({}).currentVersion).toThrow();
    expect(
      () =>
        new AuditHmacKeyring({
          AUDIT_HMAC_KEY_VERSION: "1",
        }).currentVersion,
    ).toThrow();
  });

  test("拒绝 /run/secrets 之外的路径与非法版本", () => {
    expect(
      () =>
        new AuditHmacKeyring({
          AUDIT_HMAC_KEY_VERSION: "1",
          AUDIT_HMAC_KEYRING_FILE: "./secrets/audit_hmac_keyring",
        }).currentVersion,
    ).toThrow();
    expect(
      () =>
        new AuditHmacKeyring({
          AUDIT_HMAC_KEY_VERSION: "not-a-number",
          AUDIT_HMAC_KEYRING_FILE: "/run/secrets/audit_hmac_keyring",
        }).currentVersion,
    ).toThrow();
  });
});
