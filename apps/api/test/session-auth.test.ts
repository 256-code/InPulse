import { randomBytes } from "node:crypto";

import { describe, expect, test } from "vitest";

import {
  parseHmacKeyringFile,
  VersionedHmacKeyring,
  type HmacKeyringEntry,
} from "../src/auth/keyring.js";
import { SessionTokenService } from "../src/auth/session-token.service.js";
import {
  constantTimeEqual,
  generateOpaqueToken,
  hashOpaqueToken,
  isValidOpaqueToken,
} from "../src/auth/token.js";

function entry(version: number, bytes = 32): HmacKeyringEntry {
  return { version, key: randomBytes(bytes) };
}

describe("VersionedHmacKeyring", () => {
  test("从条目构造并按版本取密钥", () => {
    const first = entry(1);
    const second = entry(2);
    const keyring = VersionedHmacKeyring.fromEntries([second, first], 2);

    expect(keyring.currentVersion).toBe(2);
    expect(keyring.currentKey()).toBe(second.key);
    expect(keyring.keyFor(1)).toBe(first.key);
  });

  test("拒绝空 keyring、重复版本、缺失当前版本、非法版本与短密钥", () => {
    expect(() => VersionedHmacKeyring.fromEntries([], 1)).toThrow();
    expect(() =>
      VersionedHmacKeyring.fromEntries([entry(1), entry(1)], 1),
    ).toThrow();
    expect(() => VersionedHmacKeyring.fromEntries([entry(2)], 1)).toThrow();
    expect(() => VersionedHmacKeyring.fromEntries([entry(0)], 1)).toThrow();
    expect(() =>
      VersionedHmacKeyring.fromEntries(
        [{ version: 1, key: randomBytes(16) }],
        1,
      ),
    ).toThrow();
  });

  test("解析 version:hexkey 文件并忽略注释与空行", () => {
    const key = randomBytes(32);
    const entries = parseHmacKeyringFile(
      `# comment\n1: ${key.toString("hex")}\n\n2:${key.toString("hex")}\n`,
    );
    expect(entries).toHaveLength(2);
    expect(entries[1]!.version).toBe(2);
  });

  test("拒绝格式错误的 keyring 行", () => {
    expect(() => parseHmacKeyringFile("1:short\n")).toThrow();
    expect(() => parseHmacKeyringFile("not-a-line\n")).toThrow();
  });

  test("fromEnv 缺配置或非 /run/secrets 路径时 fail closed", () => {
    expect(() => VersionedHmacKeyring.fromEnv({})).toThrow();
    expect(() =>
      VersionedHmacKeyring.fromEnv({ SESSION_HASH_KEY_VERSION: "1" }),
    ).toThrow();
    expect(() =>
      VersionedHmacKeyring.fromEnv({
        SESSION_HASH_KEY_VERSION: "1",
        SESSION_HASH_KEYRING_FILE: "./dev/keyring",
      }),
    ).toThrow();
    expect(() =>
      VersionedHmacKeyring.fromEnv({
        SESSION_HASH_KEY_VERSION: "abc",
        SESSION_HASH_KEYRING_FILE: "/run/secrets/session_hash_keyring",
      }),
    ).toThrow();
  });
});

describe("opaque session token", () => {
  test("生成 43 字符 base64url 令牌并拒绝非法格式", () => {
    const token = generateOpaqueToken();
    expect(isValidOpaqueToken(token)).toBe(true);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isValidOpaqueToken("short")).toBe(false);
  });

  test("HMAC-SHA-256 生成 32 字节稳定哈希，不同令牌哈希不同", () => {
    const key = randomBytes(32);
    const first = generateOpaqueToken();
    const second = generateOpaqueToken();
    const hash = hashOpaqueToken(first, key);
    expect(hash).toHaveLength(32);
    expect(hashOpaqueToken(first, key).equals(hash)).toBe(true);
    expect(hashOpaqueToken(second, key).equals(hash)).toBe(false);
    expect(() => hashOpaqueToken("not-valid", key)).toThrow();
  });

  test("常量时间比较", () => {
    const left = Buffer.from("a".repeat(32));
    const right = Buffer.from("a".repeat(32));
    const other = Buffer.from("b".repeat(32));
    expect(constantTimeEqual(left, right)).toBe(true);
    expect(constantTimeEqual(left, other)).toBe(false);
    expect(constantTimeEqual(left, Buffer.from("a"))).toBe(false);
  });
});

describe("SessionTokenService", () => {
  test("签发预认证材料：双令牌互异、哈希 32 字节、版本与 keyring 一致", () => {
    const keyring = VersionedHmacKeyring.fromEntries([entry(1), entry(2)], 2);
    const service = new SessionTokenService(keyring);
    const material = service.issuePreauthMaterial();

    expect(material.sessionToken).not.toBe(material.csrfToken);
    expect(isValidOpaqueToken(material.sessionToken)).toBe(true);
    expect(isValidOpaqueToken(material.csrfToken)).toBe(true);
    expect(material.sessionTokenHash).toHaveLength(32);
    expect(material.csrfTokenHash).toHaveLength(32);
    expect(material.tokenHashKeyVersion).toBe(2);
    expect(
      material.sessionTokenHash.equals(
        hashOpaqueToken(material.sessionToken, keyring.currentKey()),
      ),
    ).toBe(true);
  });

  test("按记录密钥版本重算旧哈希", () => {
    const keyring = VersionedHmacKeyring.fromEntries([entry(1), entry(2)], 2);
    const service = new SessionTokenService(keyring);
    const token = generateOpaqueToken();
    const legacy = service.hashWithVersion(token, 1);
    expect(legacy.equals(hashOpaqueToken(token, keyring.keyFor(1)))).toBe(true);
  });
});
