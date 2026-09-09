import { describe, expect, test, vi } from "vitest";

import { MfaVerifyController } from "../src/auth/mfa-verify.controller.js";
import { invalidMfaSession } from "../src/auth/mfa-verify.error.js";
import { mfaRateLimited } from "../src/auth/mfa-rate-limit.error.js";
import type {
  VerifyMfaInput,
  VerifyMfaResult,
} from "../src/auth/mfa-verify.service.js";

class FakeMfaVerifyService {
  verifyCalls = 0;
  lastInput: VerifyMfaInput | undefined;
  verifyError: unknown;

  async verify(input: VerifyMfaInput): Promise<VerifyMfaResult> {
    this.verifyCalls += 1;
    this.lastInput = input;
    if (this.verifyError !== undefined) {
      throw this.verifyError;
    }
    return {
      csrfToken: "B".repeat(43),
      authState: "AUTHENTICATED",
    };
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

describe("MfaVerifyController", () => {
  test("Origin/Referer 缺失时返回 403 且不调用服务", async () => {
    const service = new FakeMfaVerifyService();
    const controller = new MfaVerifyController(service as never);
    const response = responseFixture();

    const result = await controller.verify(
      requestFixture({}),
      response as never,
      { code: "123456" },
      { "x-csrf-token": "B".repeat(43) },
    );

    expect(response.status).toHaveBeenCalledWith(403);
    expect(result).toMatchObject({ code: "CSRF_ORIGIN_REJECTED" });
    expect(service.verifyCalls).toBe(0);
  });

  test("服务层验证错误映射为统一错误信封", async () => {
    const service = new FakeMfaVerifyService();
    service.verifyError = invalidMfaSession();
    const controller = new MfaVerifyController(service as never);
    const response = responseFixture();

    const result = await controller.verify(
      requestFixture({
        host: "localhost",
        origin: "http://localhost",
        cookie: "__Host-session=A".repeat(43),
        "x-csrf-token": "B".repeat(43),
      }),
      response as never,
      { code: "123456" },
      { "x-csrf-token": "B".repeat(43) },
    );

    expect(response.status).toHaveBeenCalledWith(401);
    expect(result).toMatchObject({ code: "MFA_CHALLENGE_SESSION_REQUIRED" });
    expect(service.verifyCalls).toBe(1);
  });

  test("验证成功返回完整态与 CSRF 并禁止缓存", async () => {
    const service = new FakeMfaVerifyService();
    const controller = new MfaVerifyController(service as never);
    const response = responseFixture();

    const result = await controller.verify(
      requestFixture(
        {
          host: "localhost",
          origin: "http://localhost",
          cookie: "__Host-session=A".repeat(43),
          "x-csrf-token": "B".repeat(43),
        },
        { code: "123456" },
      ),
      response as never,
      { code: "123456" },
      { "x-csrf-token": "B".repeat(43) },
    );

    expect(service.verifyCalls).toBe(1);
    expect(service.lastInput).toMatchObject({
      code: "123456",
      clientIp: "unknown",
      csrfToken: "B".repeat(43),
    });
    expect(result).toEqual({
      csrfToken: "B".repeat(43),
      authState: "AUTHENTICATED",
    });
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.headers["Cache-Control"]).toBe("no-store");
  });

  test("429 映射为统一错误信封", async () => {
    const service = new FakeMfaVerifyService();
    service.verifyError = mfaRateLimited();
    const controller = new MfaVerifyController(service as never);
    const response = responseFixture();

    const result = await controller.verify(
      requestFixture(
        {
          host: "localhost",
          origin: "http://localhost",
          cookie: "__Host-session=A".repeat(43),
          "x-csrf-token": "B".repeat(43),
        },
        { code: "123456" },
      ),
      response as never,
      { code: "123456" },
      { "x-csrf-token": "B".repeat(43) },
    );

    expect(response.status).toHaveBeenCalledWith(429);
    expect(result).toMatchObject({
      code: "MFA_VERIFY_RATE_LIMITED",
      details: { reason: "mfa-rate-limited" },
    });
  });
});
