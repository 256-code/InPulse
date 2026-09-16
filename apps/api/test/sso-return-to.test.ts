import { describe, expect, test } from "vitest";

import { normalizeReturnTo } from "../src/auth/sso/sso-return-to.js";

describe("normalizeReturnTo（ADR-032 开放重定向防线）", () => {
  test("接受站内相对路径并保留查询串", () => {
    expect(normalizeReturnTo("/projects")).toBe("/projects");
    expect(normalizeReturnTo("/projects/7?tab=1")).toBe("/projects/7?tab=1");
    expect(normalizeReturnTo("/")).toBe("/");
  });

  test("丢弃 fragment，只保留路径与查询串", () => {
    expect(normalizeReturnTo("/projects#section")).toBe("/projects");
  });

  test("拒绝绝对地址与协议相对地址", () => {
    expect(normalizeReturnTo("https://evil.example.com")).toBeNull();
    expect(normalizeReturnTo("//evil.example.com")).toBeNull();
    expect(normalizeReturnTo("http://127.0.0.1:5173/login")).toBeNull();
  });

  test("拒绝反斜杠、控制字符与双重编码绕过", () => {
    expect(normalizeReturnTo("/\\evil.example.com")).toBeNull();
    expect(normalizeReturnTo("/%5cevil.example.com")).toBeNull();
    expect(normalizeReturnTo("/%255cevil.example.com")).toBeNull();
    expect(normalizeReturnTo("/a%00b")).toBeNull();
    expect(normalizeReturnTo("/a%2500b")).toBeNull();
    expect(normalizeReturnTo("/a\nb")).toBeNull();
  });

  test("拒绝空值与超长输入", () => {
    expect(normalizeReturnTo(undefined)).toBeNull();
    expect(normalizeReturnTo("")).toBeNull();
    expect(normalizeReturnTo("   ")).toBeNull();
    expect(normalizeReturnTo(`/${"a".repeat(2001)}`)).toBeNull();
  });

  test("拒绝无法解码的百分号序列", () => {
    expect(normalizeReturnTo("/%E0%A4%A")).toBeNull();
  });
});
