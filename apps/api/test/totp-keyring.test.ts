import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import {
  VersionedAeadKeyring,
  parseAeadKeyringFile,
} from "../src/auth/totp-keyring.js";

function entry(version: number, bytes = 32) {
  return { version, key: randomBytes(bytes) };
}

describe("VersionedAeadKeyring", () => {
  test("按版本取 TOTP KEK，当前版本可用于加密", () => {
    const oldKey = entry(1);
    const currentKey = entry(2);
    const keyring = VersionedAeadKeyring.fromEntries([currentKey, oldKey], 2);

    expect(keyring.currentVersion).toBe(2);
    expect(keyring.currentKey()).toBe(currentKey.key);
    expect(keyring.keyFor(1)).toBe(oldKey.key);
    expect(keyring.versions).toEqual([1, 2]);
  });

  test("拒绝空 keyring、重复版本、缺失当前版本、非法版本与短密钥", () => {
    expect(() => VersionedAeadKeyring.fromEntries([], 1)).toThrow();
    expect(() =>
      VersionedAeadKeyring.fromEntries([entry(1), entry(1)], 1),
    ).toThrow();
    expect(() => VersionedAeadKeyring.fromEntries([entry(2)], 1)).toThrow();
    expect(() => VersionedAeadKeyring.fromEntries([entry(0)], 1)).toThrow();
    expect(() =>
      VersionedAeadKeyring.fromEntries(
        [{ version: 1, key: randomBytes(16) }],
        1,
      ),
    ).toThrow();
  });

  test("解析 version:hexkey 并忽略注释与空行", () => {
    const key = randomBytes(32);
    const entries = parseAeadKeyringFile(
      `# comment\n1: ${key.toString("hex")}\n\n2:${key.toString("hex")}\n`,
    );
    expect(entries).toHaveLength(2);
    expect(entries[1]?.version).toBe(2);
  });

  test("拒绝非法 keyring 行", () => {
    expect(() => parseAeadKeyringFile("1:short\n")).toThrow();
    expect(() => parseAeadKeyringFile("not-a-line\n")).toThrow();
  });

  test("fromEnv 缺配置或非 /run/secrets 路径时 fail closed", () => {
    expect(() => VersionedAeadKeyring.fromEnv({})).toThrow();
    expect(() =>
      VersionedAeadKeyring.fromEnv({ TOTP_KEK_VERSION: "1" }),
    ).toThrow();
    expect(() =>
      VersionedAeadKeyring.fromEnv({
        TOTP_KEK_VERSION: "1",
        TOTP_KEK_KEYRING_FILE: "./dev/totp_keyring",
      }),
    ).toThrow();
    expect(() =>
      VersionedAeadKeyring.fromEnv({
        TOTP_KEK_VERSION: "abc",
        TOTP_KEK_KEYRING_FILE: "/run/secrets/totp_kek_keyring",
      }),
    ).toThrow();
  });

  test("仅 NODE_ENV=test 且显式开关时允许测试临时 keyring 路径", async () => {
    const directory = await mkdtemp(join(tmpdir(), "inpulse-totp-keyring-"));
    try {
      const key = randomBytes(32).toString("hex");
      const keyringFile = join(directory, "keyring");
      await writeFile(keyringFile, `1: ${key}\n`, "utf8");

      const baseEnv = {
        TOTP_KEK_VERSION: "1",
        TOTP_KEK_KEYRING_FILE: keyringFile,
      };
      expect(() => VersionedAeadKeyring.fromEnv(baseEnv)).toThrow(
        /\/run\/secrets\//,
      );
      expect(() =>
        VersionedAeadKeyring.fromEnv({
          ...baseEnv,
          NODE_ENV: "test",
        }),
      ).toThrow(/\/run\/secrets\//);
      expect(() =>
        VersionedAeadKeyring.fromEnv({
          ...baseEnv,
          TOTP_KEK_KEYRING_TEST_PATH: "1",
        }),
      ).toThrow(/\/run\/secrets\//);

      const keyring = VersionedAeadKeyring.fromEnv({
        ...baseEnv,
        NODE_ENV: "test",
        TOTP_KEK_KEYRING_TEST_PATH: "1",
      });
      expect(keyring.currentKey().toString("hex")).toBe(key);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
