import { describe, expect, test, vi } from "vitest";

import { LoginError } from "../src/auth/login.error.js";
import { MfaRateLimitError } from "../src/auth/mfa-rate-limit.error.js";
import { MfaReauthenticateController } from "../src/auth/mfa-reauthenticate.controller.js";
import { MfaReauthenticateError } from "../src/auth/mfa-reauthenticate.error.js";
import type { ReauthenticateAdminInput } from "../src/auth/mfa-reauthenticate.service.js";

const REAUTH_VALID_PASSWORD = "correct-password";
const REAUTH_INVALID_PASSWORD = "secret";

class FakeMfaReauthenticateService {
  reauthenticateCalls = 0;
  lastInput: ReauthenticateAdminInput | undefined;
  reauthenticateError: unknown;

  async reauthenticate(input: ReauthenticateAdminInput): Promise<void> {
    this.reauthenticateCalls += 1;
    this.lastInput = input;
    if (this.reauthenticateError !== undefined) {
      throw this.reauthenticateError;
    }
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
  body: unknown = {},
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

function validRequest(
  headers: Readonly<Record<string, string>> = {
    host: "localhost",
    origin: "http://localhost",
    cookie: "__Host-session=A".repeat(43),
    "x-csrf-token": "B".repeat(43),
  },
) {
  return {
    headers,
    body: { password: REAUTH_VALID_PASSWORD, code: "123456" },
  };
}

describe("MfaReauthenticateController", () => {
  test("Origin/Referer 缺失时返回 403 且不调用服务", async () => {
    const service = new FakeMfaReauthenticateService();
    const controller = new MfaReauthenticateController(service as never);
    const response = responseFixture();

    const result = await controller.reauthenticate(
      requestFixture({}),
      response as never,
      { password: REAUTH_INVALID_PASSWORD, code: "123456" },
    );

    expect(response.status).toHaveBeenCalledWith(403);
    expect(result).toMatchObject({ code: "CSRF_ORIGIN_REJECTED" });
    expect(service.reauthenticateCalls).toBe(0);
  });

  test("密码或验证码格式无效时返回 422", async () => {
    const service = new FakeMfaReauthenticateService();
    const controller = new MfaReauthenticateController(service as never);
    const response = responseFixture();

    const result = await controller.reauthenticate(
      requestFixture(
        {
          host: "localhost",
          origin: "http://localhost",
        },
        { password: REAUTH_INVALID_PASSWORD, code: "12345" },
      ),
      response as never,
      { password: REAUTH_INVALID_PASSWORD, code: "12345" },
    );

    expect(response.status).toHaveBeenCalledWith(422);
    expect(result).toMatchObject({ code: "REAUTH_VALIDATION_FAILED" });
    expect(service.reauthenticateCalls).toBe(0);
  });

  test("重认证成功返回 204 并禁止缓存", async () => {
    const service = new FakeMfaReauthenticateService();
    const controller = new MfaReauthenticateController(service as never);
    const response = responseFixture();
    const request = validRequest();

    const result = await controller.reauthenticate(
      request as never,
      response as never,
      request.body,
    );

    expect(service.reauthenticateCalls).toBe(1);
    expect(service.lastInput).toMatchObject({
      password: REAUTH_VALID_PASSWORD,
      code: "123456",
      clientIp: "unknown",
      csrfToken: "B".repeat(43),
    });
    expect(result).toBeUndefined();
    expect(response.status).toHaveBeenCalledWith(204);
    expect(response.headers["Cache-Control"]).toBe("no-store");
  });

  test("业务错误映射为统一错误信封", async () => {
    const service = new FakeMfaReauthenticateService();
    service.reauthenticateError = new MfaReauthenticateError(
      409,
      "REAUTH_STATE_CONFLICT",
      "重认证状态或 TOTP time-step 已变化",
      "reauth-conflict",
    );
    const controller = new MfaReauthenticateController(service as never);
    const response = responseFixture();
    const request = validRequest();

    const result = await controller.reauthenticate(
      request as never,
      response as never,
      request.body,
    );

    expect(response.status).toHaveBeenCalledWith(409);
    expect(result).toMatchObject({
      code: "REAUTH_STATE_CONFLICT",
      details: { reason: "reauth-conflict" },
    });
  });

  test("MFA 与登录限流都映射为 429", async () => {
    for (const error of [
      new MfaRateLimitError(),
      new LoginError(
        429,
        "LOGIN_RATE_LIMITED",
        "登录失败次数过多，请稍后再试",
        "login-rate-limited",
      ),
    ]) {
      const service = new FakeMfaReauthenticateService();
      service.reauthenticateError = error;
      const controller = new MfaReauthenticateController(service as never);
      const response = responseFixture();
      const request = validRequest();

      const result = await controller.reauthenticate(
        request as never,
        response as never,
        request.body,
      );

      expect(response.status).toHaveBeenCalledWith(429);
      expect(result).toMatchObject({ code: error.code });
    }
  });
});
