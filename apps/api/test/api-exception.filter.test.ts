import { NotFoundException } from "@nestjs/common";
import { describe, expect, test, vi } from "vitest";

import { ApiExceptionFilter } from "../src/http/api-exception.filter.js";
import {
  ApiHttpError,
  ContractResponseError,
  ContractValidationError,
} from "../src/http/contract-errors.js";

function filterFixture() {
  const headers: Record<string, string> = {};
  const body = { status: 0, json: undefined as unknown };
  const response = {
    setHeader: vi.fn((name: string, value: string) => {
      headers[name] = value;
    }),
    status: vi.fn((status: number) => {
      body.status = status;
      return response;
    }),
    json: vi.fn((value: unknown) => {
      body.json = value;
    }),
    headers,
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  };
  return { response, host, body };
}

describe("ApiExceptionFilter", () => {
  test("契约请求校验错误映射为 422 并设置 X-Request-Id", () => {
    const { response, host, body } = filterFixture();
    new ApiExceptionFilter().catch(
      new ContractValidationError("login", "body", [
        { path: "loginName", message: "Too short" },
      ]),
      host as never,
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      "X-Request-Id",
      expect.any(String),
    );
    expect(body.status).toBe(422);
    expect(body.json).toMatchObject({
      code: "VALIDATION_FAILED",
      details: { issues: expect.stringContaining("loginName") },
      requestId: headersRequestId(response),
    });
  });

  test("显式 ApiHttpError 保留脱敏 code 与 status", () => {
    const { response, body } = filterFixture();
    new ApiExceptionFilter().catch(
      new ApiHttpError(403, "CSRF_ORIGIN_REJECTED", "同一源校验失败", {
        reason: "missing-origin",
      }),
      { switchToHttp: () => ({ getResponse: () => response }) } as never,
    );
    expect(body.status).toBe(403);
    expect(body.json).toMatchObject({
      code: "CSRF_ORIGIN_REJECTED",
      details: { reason: "missing-origin" },
    });
  });

  test("未匹配路由的 HttpException 映射为统一 404 且不泄漏内部文本", () => {
    const { response, body } = filterFixture();
    new ApiExceptionFilter().catch(
      new NotFoundException("Cannot GET /api/v1/secret"),
      { switchToHttp: () => ({ getResponse: () => response }) } as never,
    );
    expect(body.status).toBe(404);
    expect(body.json).toMatchObject({
      code: "NOT_FOUND",
      message: "请求的资源不存在",
    });
    expect(JSON.stringify(body.json)).not.toContain("secret");
  });

  test("响应契约错误和未预期错误统一为 500", () => {
    const responseError = filterFixture();
    new ApiExceptionFilter().catch(
      new ContractResponseError("getHealth", 200),
      {
        switchToHttp: () => ({ getResponse: () => responseError.response }),
      } as never,
    );
    expect(responseError.body.status).toBe(500);
    expect(responseError.body.json).toMatchObject({
      code: "INTERNAL_ERROR",
    });

    const genericError = filterFixture();
    new ApiExceptionFilter().catch(new Error("database password leaked"), {
      switchToHttp: () => ({ getResponse: () => genericError.response }),
    } as never);
    expect(genericError.body.status).toBe(500);
    expect(JSON.stringify(genericError.body.json)).not.toContain("password");
    expect(genericError.body.json).toMatchObject({
      code: "INTERNAL_ERROR",
      details: {},
    });
  });
});

function headersRequestId(response: {
  readonly headers: Readonly<Record<string, string>>;
}): string {
  return response.headers["X-Request-Id"]!;
}
