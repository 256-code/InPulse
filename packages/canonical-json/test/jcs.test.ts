import { describe, expect, test } from "vitest";

import { canonicalizeJson } from "../src/index.js";

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
