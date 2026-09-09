import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

  test("测试环境必须显式选择临时 keyring，否则仍 fail closed", async () => {
    const directory = await mkdtemp(join(tmpdir(), "inpulse-audit-"));
    const file = join(directory, "audit.keyring");
    await writeFile(file, `1:${"ab".repeat(32)}\n`, "utf8");
    try {
      expect(
        () =>
          new AuditHmacKeyring({
            NODE_ENV: "test",
            AUDIT_HMAC_KEY_VERSION: "1",
            AUDIT_HMAC_KEYRING_FILE: file,
          }).currentVersion,
      ).toThrow();

      const keyring = new AuditHmacKeyring({
        NODE_ENV: "test",
        AUDIT_HMAC_KEY_VERSION: "1",
        AUDIT_HMAC_KEYRING_FILE: file,
        AUDIT_HMAC_KEYRING_TEST_PATH: "1",
      });
      expect(keyring.currentVersion).toBe(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
