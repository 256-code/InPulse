import { describe, expect, test } from "vitest";

import { parseSigningKeyring, parseWormCredentials } from "../src/config.js";

const keyHex = "ab".repeat(32);

describe("归档签名密钥解析", () => {
  test("取最大版本为当前版本，允许保留旧版本", () => {
    const keyring = parseSigningKeyring(`1:${keyHex}\n3:${"cd".repeat(32)}\n`);
    expect(keyring.currentVersion).toBe(3);
    expect(keyring.keys.size).toBe(2);
    expect(keyring.keys.get(1)?.toString("hex")).toBe(keyHex);
  });

  test("拒绝非法行、零版本与空文件", () => {
    expect(() => parseSigningKeyring("not-a-key\n")).toThrow(
      "ARCHIVE_SIGNING_KEY_FILE",
    );
    expect(() => parseSigningKeyring("0:" + keyHex + "\n")).toThrow("version");
    expect(() => parseSigningKeyring("\n\n")).toThrow("at least one key");
  });
});

describe("WORM 凭据解析", () => {
  const base = {
    version: 1,
    endpoint: "https://s3.example.com",
    region: "cn-north-1",
    bucket: "audit-worm",
    accessKeyId: "key",
    secretAccessKey: "secret",
  };

  test("解析默认值与前缀清理", () => {
    const credentials = parseWormCredentials(
      JSON.stringify({ ...base, prefix: "/team/audit/" }),
      { requireHttps: true },
    );
    expect(credentials.prefix).toBe("team/audit");
    expect(credentials.forcePathStyle).toBe(true);
    expect(credentials.objectLock).toBeNull();
  });

  test("解析对象锁配置", () => {
    const credentials = parseWormCredentials(
      JSON.stringify({
        ...base,
        forcePathStyle: false,
        objectLock: { mode: "COMPLIANCE", retainDays: 3650 },
      }),
      { requireHttps: true },
    );
    expect(credentials.forcePathStyle).toBe(false);
    expect(credentials.objectLock).toEqual({
      mode: "COMPLIANCE",
      retainDays: 3650,
    });
  });

  test("拒绝非 JSON、错误版本、http 生产端点与非法对象锁", () => {
    expect(() => parseWormCredentials("nope", { requireHttps: false })).toThrow(
      "valid JSON",
    );
    expect(() =>
      parseWormCredentials(JSON.stringify({ ...base, version: 2 }), {
        requireHttps: false,
      }),
    ).toThrow("version");
    expect(() =>
      parseWormCredentials(
        JSON.stringify({ ...base, endpoint: "http://s3.example.com" }),
        { requireHttps: true },
      ),
    ).toThrow("https");
    expect(() =>
      parseWormCredentials(
        JSON.stringify({
          ...base,
          objectLock: { mode: "NONE", retainDays: 1 },
        }),
        { requireHttps: false },
      ),
    ).toThrow("objectLock.mode");
    expect(() =>
      parseWormCredentials(
        JSON.stringify({
          ...base,
          objectLock: { mode: "COMPLIANCE", retainDays: 0 },
        }),
        { requireHttps: false },
      ),
    ).toThrow("retainDays");
  });
});
