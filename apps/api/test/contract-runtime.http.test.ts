import type { AddressInfo } from "node:net";

import "reflect-metadata";

import { type INestApplication } from "@nestjs/common";
import { MODULE_METADATA } from "@nestjs/common/constants.js";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { LoginController } from "../src/auth/login.controller.js";
import type { LoginResult } from "../src/auth/login.service.js";
import { LoginService } from "../src/auth/login.service.js";
import { ApiExceptionFilter } from "../src/http/api-exception.filter.js";
import { ContractResponseInterceptor } from "../src/http/contract-response.interceptor.js";

function loginResult(): LoginResult {
  return {
    csrfToken: "A".repeat(43),
    authState: "AUTHENTICATED",
    cookies: [
      { name: "__Host-preauth", value: null, maxAgeSeconds: 0 },
      {
        name: "__Host-session",
        value: "B".repeat(43),
        maxAgeSeconds: 7 * 24 * 60 * 60,
      },
    ],
  };
}

class FakeLoginService {
  result: LoginResult = loginResult();

  async login(): Promise<LoginResult> {
    return this.result;
  }
}

const fakeService = new FakeLoginService();

class ContractRuntimeModule {}

Reflect.defineMetadata(
  MODULE_METADATA.CONTROLLERS,
  [LoginController],
  ContractRuntimeModule,
);
Reflect.defineMetadata(
  MODULE_METADATA.PROVIDERS,
  [
    { provide: LoginService, useValue: fakeService },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ContractResponseInterceptor },
  ],
  ContractRuntimeModule,
);

describe("契约 Pipe/Serializer HTTP 冒烟", () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    app = await NestFactory.create(ContractRuntimeModule, { logger: false });
    app.setGlobalPrefix("api/v1");
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app?.close();
  });

  async function post(body: unknown): Promise<{
    readonly status: number;
    readonly headers: Headers;
    readonly json: Record<string, unknown> | null;
  }> {
    const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        host: new URL(baseUrl).host,
        origin: new URL(baseUrl).origin,
        cookie: "__Host-preauth=token",
        "x-csrf-token": "A".repeat(43),
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    return {
      status: response.status,
      headers: response.headers,
      json:
        text.length === 0
          ? null
          : (JSON.parse(text) as Record<string, unknown>),
    };
  }

  test("有效请求由 Zod Pipe 解析并由 Serializer 剔除未知字段", async () => {
    fakeService.result = {
      ...loginResult(),
      extra: "must-strip",
    } as LoginResult;
    const result = await post({
      loginName: "alice",
      password: "secret",
    });
    expect(result.status).toBe(200);
    expect(result.json).toEqual({
      csrfToken: "A".repeat(43),
      authState: "AUTHENTICATED",
    });
  });

  test("非法请求返回统一 422 错误体", async () => {
    fakeService.result = loginResult();
    const result = await post({ loginName: "", password: "" });
    expect(result.status).toBe(422);
    expect(result.json).toMatchObject({
      code: "VALIDATION_FAILED",
      message: "请求字段校验失败",
      details: { issues: expect.stringContaining("loginName") },
      requestId: expect.any(String),
    });
    expect(result.headers.get("x-request-id")).toBeTruthy();
  });

  test("响应不符合 Schema 时返回统一 500", async () => {
    fakeService.result = {
      ...loginResult(),
      csrfToken: "bad",
    };
    const result = await post({ loginName: "alice", password: "secret" });
    expect(result.status).toBe(500);
    expect(result.json).toEqual({
      code: "INTERNAL_ERROR",
      message: "服务器无法完成响应契约校验",
      details: {},
      requestId: expect.any(String),
    });
    expect(result.headers.get("x-request-id")).toBeTruthy();
  });

  test("未匹配路由返回统一 404 且不泄漏框架文本", async () => {
    const response = await fetch(`${baseUrl}/api/v1/not-a-real-route`);
    const body = (await response.json()) as Record<string, unknown>;
    expect(response.status).toBe(404);
    expect(body).toMatchObject({
      code: "NOT_FOUND",
      message: "请求的资源不存在",
      requestId: expect.any(String),
    });
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect(JSON.stringify(body)).not.toContain("not-a-real-route");
  });

  test("同源校验作为 Guard 先于 Zod Pipe 返回 403", async () => {
    const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "__Host-preauth=token",
        "x-csrf-token": "A".repeat(43),
      },
      body: JSON.stringify({ loginName: "", password: "" }),
    });
    const body = (await response.json()) as Record<string, unknown>;
    expect(response.status).toBe(403);
    expect(body).toMatchObject({
      code: "CSRF_ORIGIN_REJECTED",
      details: { reason: "missing-origin-and-referer" },
      requestId: expect.any(String),
    });
  });
});
