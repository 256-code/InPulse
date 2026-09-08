import { describe, expect, test } from "vitest";

import {
  defaultIdempotencyExpiry,
  hexDigestToRequestHash,
  isReplayMatch,
  validateSuccessResponse,
  type IdempotencySuccess,
} from "../src/idempotency/store";

const hex = "ab".repeat(32);

describe("hexDigestToRequestHash", () => {
  test("64 位小写十六进制转 32 字节", () => {
    const buffer = hexDigestToRequestHash(hex);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBe(32);
    expect(buffer.toString("hex")).toBe(hex);
  });

  test("拒绝非法输入", () => {
    expect(() => hexDigestToRequestHash("not-a-hash")).toThrow();
    expect(() => hexDigestToRequestHash(hex.toUpperCase())).toThrow();
    expect(() => hexDigestToRequestHash("a".repeat(63))).toThrow();
  });
});

describe("defaultIdempotencyExpiry", () => {
  test("为创建时间 + 30 天", () => {
    const now = new Date("2026-09-08T00:00:00Z");
    const expiry = defaultIdempotencyExpiry(now);
    expect(expiry.getTime()).toBe(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  });
});

describe("isReplayMatch", () => {
  const base = {
    requestHash: hexDigestToRequestHash(hex),
    idempotencyContractVersion: "1",
    requestHashKeyVersion: 3,
  };

  test("同哈希、同契约版本、同密钥版本为可重放", () => {
    expect(isReplayMatch(base, base)).toBe(true);
  });

  test("任一语义字段不同则不可重放", () => {
    expect(
      isReplayMatch(base, {
        ...base,
        requestHash: hexDigestToRequestHash("cd".repeat(32)),
      }),
    ).toBe(false);
    expect(
      isReplayMatch(base, { ...base, idempotencyContractVersion: "2" }),
    ).toBe(false);
    expect(isReplayMatch(base, { ...base, requestHashKeyVersion: 4 })).toBe(
      false,
    );
  });
});

describe("validateSuccessResponse", () => {
  const ok: IdempotencySuccess = {
    responseStatus: 200,
    responseSchemaRef: "ProjectResponse",
    replayPolicyVersion: "1",
    replayAuthPolicyVersion: "1",
    replayAuthContext: { actorId: 1 },
    responseHasBody: true,
    responseBody: { id: 1 },
  };

  test("合法的 2xx 有权柄响应通过", () => {
    expect(() => validateSuccessResponse(ok)).not.toThrow();
  });

  test("非 2xx / 缺策略 / 缺 body 约束被拒绝", () => {
    expect(() =>
      validateSuccessResponse({ ...ok, responseStatus: 300 }),
    ).toThrow();
    expect(() =>
      validateSuccessResponse({ ...ok, replayPolicyVersion: "" }),
    ).toThrow();
    expect(() =>
      validateSuccessResponse({ ...ok, replayAuthContext: null as never }),
    ).toThrow();
    expect(() =>
      validateSuccessResponse({ ...ok, responseBody: null }),
    ).toThrow();
  });

  test("无 body 时响应 schema/body 必须为 null", () => {
    expect(() =>
      validateSuccessResponse({
        ...ok,
        responseHasBody: false,
        responseSchemaRef: null,
        responseBody: null,
      }),
    ).not.toThrow();
    expect(() =>
      validateSuccessResponse({
        ...ok,
        responseHasBody: false,
        responseSchemaRef: "X",
        responseBody: null,
      }),
    ).toThrow();
  });
});
