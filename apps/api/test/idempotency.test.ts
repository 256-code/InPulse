import { describe, expect, test } from "vitest";

import {
  buildIdempotencyDigest,
  idempotencyDigestFormat,
} from "../src/idempotency/digest";
import { canonicalizeJson } from "../src/idempotency/jcs";

describe("canonicalizeJson (JCS)", () => {
  test("对象键按字典序排序并保持嵌套结构", () => {
    expect(canonicalizeJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(canonicalizeJson({ b: "x", a: { y: 2, x: 1 } })).toBe(
      '{"a":{"x":1,"y":2},"b":"x"}',
    );
  });

  test("数组顺序即结构顺序，不重排", () => {
    expect(canonicalizeJson({ a: [3, 2, 1] })).toBe('{"a":[3,2,1]}');
  });

  test("数字使用 ECMAScript 最短表示", () => {
    expect(canonicalizeJson({ a: 1.0 })).toBe('{"a":1}');
    expect(canonicalizeJson({ a: 1e21 })).toBe('{"a":1e+21}');
  });

  test("字符串转义稳定", () => {
    expect(canonicalizeJson({ a: 'quote"<nl>\n' })).toBe(
      '{"a":"quote\\"<nl>\\n"}',
    );
  });

  test("拒绝非 JSON 安全值与非有限数字", () => {
    expect(() => canonicalizeJson({ a: undefined })).toThrow("JCS");
    expect(() => canonicalizeJson([undefined])).toThrow("JCS");
    expect(() => canonicalizeJson({ a: Number.NaN })).toThrow("JCS");
    expect(() => canonicalizeJson({ a: 1n })).toThrow("JCS");
    expect(() => canonicalizeJson({ a: new Date(0) })).toThrow("JCS");
  });
});

describe("buildIdempotencyDigest", () => {
  const hmacMaterial = "test-versioned-material";
  const base = {
    method: "POST",
    operationId: "createProject",
    idempotencyContractVersion: "1",
    digestFormat: idempotencyDigestFormat,
    requestSchemaVersion: "1",
    pathParams: { projectId: "42" },
    query: { expand: "members" },
    contentType: "application/json",
    behaviorHeaders: { "x-idempotent": "1" },
    body: { name: "demo", members: [{ id: 1 }] },
    ifMatch: undefined,
  };

  test("同一输入与密钥产生稳定摘要", () => {
    const first = buildIdempotencyDigest(base, hmacMaterial);
    const second = buildIdempotencyDigest(base, hmacMaterial);
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  test("字段顺序不影响摘要", () => {
    const reordered = buildIdempotencyDigest(
      {
        ...base,
        body: { members: [{ id: 1 }], name: "demo" },
        query: { expand: "members" },
      },
      hmacMaterial,
    );
    expect(reordered).toBe(buildIdempotencyDigest(base, hmacMaterial));
  });

  test("不同密钥产生不同摘要", () => {
    expect(buildIdempotencyDigest(base, hmacMaterial)).not.toBe(
      buildIdempotencyDigest(base, "other-versioned-material"),
    );
  });

  test("语义输入变化产生不同摘要", () => {
    expect(buildIdempotencyDigest(base, hmacMaterial)).not.toBe(
      buildIdempotencyDigest(
        { ...base, idempotencyContractVersion: "2" },
        hmacMaterial,
      ),
    );
    expect(buildIdempotencyDigest(base, hmacMaterial)).not.toBe(
      buildIdempotencyDigest(
        { ...base, body: { name: "other" } },
        hmacMaterial,
      ),
    );
  });

  test("行为相关请求头变化产生不同摘要", () => {
    expect(buildIdempotencyDigest(base, hmacMaterial)).not.toBe(
      buildIdempotencyDigest(
        { ...base, behaviorHeaders: { "x-idempotent": "2" } },
        hmacMaterial,
      ),
    );
  });

  test("If-Match 存在与否不同摘要；存在时纳入摘要", () => {
    const withIfMatch = buildIdempotencyDigest(
      { ...base, ifMatch: '"abc"' },
      hmacMaterial,
    );
    expect(withIfMatch).not.toBe(buildIdempotencyDigest(base, hmacMaterial));
    expect(withIfMatch).toBe(
      buildIdempotencyDigest({ ...base, ifMatch: '"abc"' }, hmacMaterial),
    );
  });
});
