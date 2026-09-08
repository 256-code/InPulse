import { describe, expect, test } from "vitest";

import {
  deriveCode,
  resolveProjectCode,
} from "../src/modules/projects/project-code.js";

describe("deriveCode", () => {
  test("中文与符号归一为 ASCII 大写编码", () => {
    expect(deriveCode("你好 world")).toBe("WORLD");
  });

  test("连续分隔符合并为单个下划线并去除首尾", () => {
    expect(deriveCode("  a__b--c  ")).toBe("A_B_C");
  });

  test("以数字开头时补 P 前缀", () => {
    expect(deriveCode("123 Alpha")).toBe("P123_ALPHA");
  });

  test("空名称或全符号名称无法派生", () => {
    expect(() => deriveCode("")).toThrow();
    expect(() => deriveCode("---")).toThrow();
  });
});

describe("resolveProjectCode", () => {
  test("显式编码原样保留", () => {
    expect(resolveProjectCode("任意名称", "ABC_12")).toBe("ABC_12");
  });

  test("无显式编码时按名称派生", () => {
    expect(resolveProjectCode("项目 Alpha")).toBe("ALPHA");
  });

  test("显式编码不满足格式时拒绝", () => {
    expect(() => resolveProjectCode("name", "abc")).toThrow();
    expect(() => resolveProjectCode("name", "1ABC")).toThrow();
  });
});
