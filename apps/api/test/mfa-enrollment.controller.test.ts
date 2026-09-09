import { describe, expect, test, vi } from "vitest";

import { MfaEnrollmentController } from "../src/auth/mfa-enrollment.controller.js";
import type {
  ConfirmMfaEnrollmentInput,
  ConfirmMfaEnrollmentResult,
  StartMfaEnrollmentInput,
  StartMfaEnrollmentResult,
} from "../src/auth/mfa-enrollment.service.js";
import { mfaRateLimited } from "../src/auth/mfa-rate-limit.error.js";

class FakeMfaEnrollmentService {
  startResult: StartMfaEnrollmentResult = {
    enrollmentGeneration: 1,
    secret: "A".repeat(32),
    otpauthUri: "otpauth://totp/InPulse:admin-1?secret=AAAA",
  };
  confirmResult: ConfirmMfaEnrollmentResult = {
    csrfToken: "B".repeat(43),
    authState: "AUTHENTICATED",
    recoveryCodes: ["C".repeat(20)],
    cookies: [
      { name: "__Host-preauth", value: null, maxAgeSeconds: 0 },
      { name: "__Host-session", value: "D".repeat(43), maxAgeSeconds: 3600 },
    ],
  };
  startError: Error | undefined;
  confirmError: Error | undefined;
  startCalls = 0;
  confirmCalls = 0;
  lastStartInput: StartMfaEnrollmentInput | undefined;
  lastConfirmInput: ConfirmMfaEnrollmentInput | undefined;

  async start(
    input: StartMfaEnrollmentInput,
  ): Promise<StartMfaEnrollmentResult> {
    this.startCalls += 1;
    this.lastStartInput = input;
    if (this.startError !== undefined) {
      throw this.startError;
    }
    return this.startResult;
  }

  async confirm(
    input: ConfirmMfaEnrollmentInput,
  ): Promise<ConfirmMfaEnrollmentResult> {
    this.confirmCalls += 1;
    this.lastConfirmInput = input;
    if (this.confirmError !== undefined) {
      throw this.confirmError;
    }
    return this.confirmResult;
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

describe("MfaEnrollmentController", () => {
  test("Origin/Referer 缺失时返回 403 且不调用服务", async () => {
    const service = new FakeMfaEnrollmentService();
    const controller = new MfaEnrollmentController(service as never);
    const response = responseFixture();

    const result = await controller.start(
      requestFixture({}),
      response as never,
      { expectedEnrollmentGeneration: 0 },
    );

    expect(response.status).toHaveBeenCalledWith(403);
    expect(result).toMatchObject({ code: "CSRF_ORIGIN_REJECTED" });
    expect(service.startCalls).toBe(0);
  });

  test("start 请求体无效时返回 422", async () => {
    const service = new FakeMfaEnrollmentService();
    const controller = new MfaEnrollmentController(service as never);
    const response = responseFixture();

    const result = await controller.start(
      requestFixture({ host: "localhost", origin: "http://localhost" }, {}),
      response as never,
      {},
    );

    expect(response.status).toHaveBeenCalledWith(422);
    expect(result).toMatchObject({ code: "MFA_ENROLLMENT_VALIDATION_FAILED" });
    expect(service.startCalls).toBe(0);
  });

  test("start 成功返回 Secret、otpauth URI 并禁止缓存", async () => {
    const service = new FakeMfaEnrollmentService();
    const controller = new MfaEnrollmentController(service as never);
    const response = responseFixture();

    const result = await controller.start(
      requestFixture(
        {
          host: "localhost",
          origin: "http://localhost",
          cookie: "__Host-session=A".repeat(43),
          "x-csrf-token": "B".repeat(43),
        },
        { expectedEnrollmentGeneration: 0 },
      ),
      response as never,
      { expectedEnrollmentGeneration: 0 },
    );

    expect(service.startCalls).toBe(1);
    expect(service.lastStartInput?.expectedEnrollmentGeneration).toBe(0);
    expect(result).toEqual({
      enrollmentGeneration: 1,
      secret: "A".repeat(32),
      otpauthUri: "otpauth://totp/InPulse:admin-1?secret=AAAA",
    });
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.headers["Cache-Control"]).toBe("no-store");
  });

  test("confirm 成功轮换 Cookie 并返回恢复码", async () => {
    const service = new FakeMfaEnrollmentService();
    const controller = new MfaEnrollmentController(service as never);
    const response = responseFixture();

    const result = await controller.confirm(
      requestFixture(
        {
          host: "localhost",
          origin: "http://localhost",
          cookie: "__Host-session=A".repeat(43),
          "x-csrf-token": "B".repeat(43),
        },
        { expectedEnrollmentGeneration: 1, code: "123456" },
      ),
      response as never,
      { expectedEnrollmentGeneration: 1, code: "123456" },
    );

    expect(service.confirmCalls).toBe(1);
    expect(service.lastConfirmInput?.clientIp).toBe("unknown");
    expect(result).toEqual({
      csrfToken: "B".repeat(43),
      authState: "AUTHENTICATED",
      recoveryCodes: ["C".repeat(20)],
    });
    expect(response.headers["Cache-Control"]).toBe("no-store");
    expect(response.headers["Set-Cookie"]).toHaveLength(2);
  });

  test("429 映射为统一错误信封", async () => {
    const service = new FakeMfaEnrollmentService();
    service.confirmError = mfaRateLimited();
    const controller = new MfaEnrollmentController(service as never);
    const response = responseFixture();

    const result = await controller.confirm(
      requestFixture(
        {
          host: "localhost",
          origin: "http://localhost",
          cookie: "__Host-session=A".repeat(43),
          "x-csrf-token": "B".repeat(43),
        },
        { expectedEnrollmentGeneration: 1, code: "123456" },
      ),
      response as never,
      { expectedEnrollmentGeneration: 1, code: "123456" },
    );

    expect(response.status).toHaveBeenCalledWith(429);
    expect(result).toMatchObject({
      code: "MFA_VERIFY_RATE_LIMITED",
      details: { reason: "mfa-rate-limited" },
    });
  });
});
