import { describe, expect, test } from "vitest";

import { ContractValidationError } from "../src/http/contract-errors.js";
import { ContractValidationPipe } from "../src/http/contract-validation.pipe.js";

describe("ContractValidationPipe", () => {
  test("body 由 Route Registry 的 Zod Schema 解析并应用默认值", () => {
    const value = new ContractValidationPipe("login", "body").transform({
      loginName: "alice",
      password: "secret",
    });
    expect(value).toEqual({
      loginName: "alice",
      password: "secret",
      challengeMode: "totp",
    });
  });

  test("body 校验失败抛出统一 ContractValidationError", () => {
    const pipe = new ContractValidationPipe("login", "body");
    expect(() => pipe.transform({ loginName: "", password: "" })).toThrow(
      ContractValidationError,
    );
    expect(() => pipe.transform({ loginName: "", password: "" })).toThrow(
      /login\s*\.body/,
    );
  });

  test("path 参数按契约把数字字符串转换为 number", () => {
    const value = new ContractValidationPipe(
      "getProjectActivity",
      "path",
    ).transform({ projectId: "42" });
    expect(value).toEqual({ projectId: 42 });
  });

  test("query 参数按契约 coerce limit", () => {
    const value = new ContractValidationPipe("getSearch", "query").transform({
      q: "ai",
      limit: "10",
    });
    expect(value).toEqual({ q: "ai", limit: 10 });
  });

  test("headers 只提取 Schema 声明字段，不受 Express 附加头部影响", () => {
    const value = new ContractValidationPipe(
      "createProject",
      "headers",
    ).transform({
      host: "localhost:3000",
      connection: "keep-alive",
      "x-csrf-token": "A".repeat(43),
    });
    expect(value).toEqual({ "x-csrf-token": "A".repeat(43) });
  });

  test("Route Registry 未登记请求部分时原样透传", () => {
    const value = new ContractValidationPipe("getHealth", "query").transform({
      untouched: true,
    });
    expect(value).toEqual({ untouched: true });
  });
});
