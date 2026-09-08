import { describe, expect, test, vi } from "vitest";

import type { LoginInput, LoginResult } from "../src/auth/login.service.js";
import { LoginController } from "../src/auth/login.controller.js";
import { LoginError } from "../src/auth/login.error.js";

class FakeLoginService {
  result: LoginResult = {
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
  error: LoginError | undefined;
  calls = 0;
  lastInput: LoginInput | undefined;

  async login(input: LoginInput): Promise<LoginResult> {
    this.calls += 1;
    this.lastInput = input;
    if (this.error !== undefined) {
      throw this.error;
    }
    return this.result;
  }
}

function responseFixture() {
  const headers: Record<string, string | readonly string[]> = {};
  return {
    status: vi.fn(() => undefined),
    setHeader(name: string, value: string | readonly string[]): void {
      headers[name] = value;
    },
    headers,
  };
}

function requestFixture(
  headers: Readonly<Record<string, string>> = {},
  body: unknown = { loginName: "alice", password: "secret" },
  request: {
    readonly ip?: string;
    readonly socket?: { readonly remoteAddress?: string };
  } = {},
) {
  return {
    headers,
    body,
    ...request,
  };
}

describe("LoginController", () => {
  test("Origin/Referer 均缺失时返回 403 且不调用服务", async () => {
    const service = new FakeLoginService();
    const controller = new LoginController(service as never);
    const response = responseFixture();

    const result = await controller.login(
      requestFixture({}),
      response as never,
      { loginName: "alice", password: "secret" },
    );

    expect(response.status).toHaveBeenCalledWith(403);
    expect(result).toMatchObject({ code: "CSRF_ORIGIN_REJECTED" });
    expect(service.calls).toBe(0);
  });

  test("请求体无效时返回 422", async () => {
    const service = new FakeLoginService();
    const controller = new LoginController(service as never);
    const response = responseFixture();

    const result = await controller.login(
      requestFixture(
        { host: "localhost", origin: "http://localhost" },
        { loginName: "" },
      ),
      response as never,
      { loginName: "" },
    );

    expect(response.status).toHaveBeenCalledWith(422);
    expect(result).toMatchObject({ code: "LOGIN_VALIDATION_FAILED" });
    expect(service.calls).toBe(0);
  });

  test("登录成功返回 CSRF Token、认证状态并设置 Cookie", async () => {
    const service = new FakeLoginService();
    const controller = new LoginController(service as never);
    const response = responseFixture();

    const result = await controller.login(
      requestFixture({
        host: "localhost",
        origin: "http://localhost",
        cookie: "__Host-preauth=token",
        "x-csrf-token": "A".repeat(43),
      }),
      response as never,
      { loginName: "alice", password: "secret" },
    );

    expect(service.calls).toBe(1);
    expect(service.lastInput?.clientIp).toBe("unknown");
    expect(result).toEqual({
      csrfToken: "A".repeat(43),
      authState: "AUTHENTICATED",
    });
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.headers["Cache-Control"]).toBe("no-store");
    expect(response.headers["Set-Cookie"]).toHaveLength(2);
  });

  test("LoginError 映射为统一错误信封", async () => {
    const service = new FakeLoginService();
    service.error = new LoginError(
      409,
      "AUTH_SESSION_CONFLICT",
      "已有认证 Session",
      "existing-authenticated-session",
    );
    const controller = new LoginController(service as never);
    const response = responseFixture();

    const result = await controller.login(
      requestFixture({
        host: "localhost",
        origin: "http://localhost",
        cookie: "__Host-preauth=token",
        "x-csrf-token": "A".repeat(43),
      }),
      response as never,
      { loginName: "alice", password: "secret" },
    );

    expect(response.status).toHaveBeenCalledWith(409);
    expect(result).toMatchObject({
      code: "AUTH_SESSION_CONFLICT",
      details: { reason: "existing-authenticated-session" },
    });
  });

  test("429 映射为统一错误信封", async () => {
    const service = new FakeLoginService();
    service.error = new LoginError(
      429,
      "LOGIN_RATE_LIMITED",
      "登录失败次数过多，请稍后再试",
      "login-rate-limited",
    );
    const controller = new LoginController(service as never);
    const response = responseFixture();

    const result = await controller.login(
      requestFixture({
        host: "localhost",
        origin: "http://localhost",
        cookie: "__Host-preauth=token",
        "x-csrf-token": "A".repeat(43),
      }),
      response as never,
      { loginName: "alice", password: "secret" },
    );

    expect(response.status).toHaveBeenCalledWith(429);
    expect(result).toMatchObject({
      code: "LOGIN_RATE_LIMITED",
      details: { reason: "login-rate-limited" },
    });
  });

  test("使用 request.ip 且不信任用户 X-Forwarded-For", async () => {
    const service = new FakeLoginService();
    const controller = new LoginController(service as never);
    const response = responseFixture();

    await controller.login(
      requestFixture(
        {
          host: "localhost",
          origin: "http://localhost",
          cookie: "__Host-preauth=token",
          "x-csrf-token": "A".repeat(43),
          "x-forwarded-for": "6.6.6.6",
        },
        { loginName: "alice", password: "secret" },
        { ip: "::ffff:127.0.0.1" },
      ),
      response as never,
      { loginName: "alice", password: "secret" },
    );

    expect(service.lastInput?.clientIp).toBe("127.0.0.1");
  });
});
