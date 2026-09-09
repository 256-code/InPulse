import { describe, expect, test, vi } from "vitest";

import { reauthExpired } from "../src/auth/admin-high-risk.error.js";
import { MfaRecoveryController } from "../src/auth/mfa-recovery.controller.js";
import { MfaRecoveryError } from "../src/auth/mfa-recovery.error.js";
import { mfaRateLimited } from "../src/auth/mfa-rate-limit.error.js";
import type {
  ConsumeMfaRecoveryCodeInput,
  RotateMfaRecoveryCodesInput,
} from "../src/auth/mfa-recovery.service.js";

class FakeRecoveryService {
  rotateCalls = 0;
  consumeCalls = 0;
  lastRotateInput: RotateMfaRecoveryCodesInput | undefined;
  lastConsumeInput: ConsumeMfaRecoveryCodeInput | undefined;
  error: unknown;

  async rotate(input: RotateMfaRecoveryCodesInput) {
    this.rotateCalls += 1;
    this.lastRotateInput = input;
    if (this.error !== undefined) {
      throw this.error;
    }
    return { recoveryCodes: ["A".repeat(20)] as const };
  }

  async consume(input: ConsumeMfaRecoveryCodeInput) {
    this.consumeCalls += 1;
    this.lastConsumeInput = input;
    if (this.error !== undefined) {
      throw this.error;
    }
    return { csrfToken: "B".repeat(43), authState: "AUTHENTICATED" as const };
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

function validHeaders(): Readonly<Record<string, string>> {
  return {
    host: "127.0.0.1",
    origin: "http://127.0.0.1",
    cookie: "__Host-session=A".repeat(43),
    "x-csrf-token": "B".repeat(43),
  };
}

describe("MfaRecoveryController", () => {
  test("轮换缺少同源来源时返回 403 且不调用服务", async () => {
    const service = new FakeRecoveryService();
    const controller = new MfaRecoveryController(service as never);
    const response = responseFixture();

    const result = await controller.rotate(
      { headers: { host: "127.0.0.1" }, body: undefined },
      response as never,
    );

    expect(response.status).toHaveBeenCalledWith(403);
    expect(result).toMatchObject({ code: "CSRF_ORIGIN_REJECTED" });
    expect(service.rotateCalls).toBe(0);
  });

  test("轮换成功返回恢复码并禁止缓存", async () => {
    const service = new FakeRecoveryService();
    const controller = new MfaRecoveryController(service as never);
    const response = responseFixture();

    const result = await controller.rotate(
      { headers: validHeaders(), body: undefined },
      response as never,
    );

    expect(service.rotateCalls).toBe(1);
    expect(service.lastRotateInput).toMatchObject({
      cookieHeader: validHeaders().cookie,
      csrfToken: validHeaders()["x-csrf-token"],
    });
    expect(result).toEqual({ recoveryCodes: ["A".repeat(20)] });
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.headers["Cache-Control"]).toBe("no-store");
  });

  test("消费恢复码格式无效时返回 422", async () => {
    const service = new FakeRecoveryService();
    const controller = new MfaRecoveryController(service as never);
    const response = responseFixture();

    const result = await controller.consume(
      { headers: validHeaders(), body: undefined },
      response as never,
      { code: "123" },
    );

    expect(response.status).toHaveBeenCalledWith(422);
    expect(result).toMatchObject({ code: "MFA_RECOVERY_VALIDATION_FAILED" });
    expect(service.consumeCalls).toBe(0);
  });

  test("消费成功使用请求 IP 并返回完整态", async () => {
    const service = new FakeRecoveryService();
    const controller = new MfaRecoveryController(service as never);
    const response = responseFixture();

    const result = await controller.consume(
      {
        headers: validHeaders(),
        body: undefined,
        ip: "198.51.100.90",
      },
      response as never,
      { code: "A".repeat(20) },
    );

    expect(service.lastConsumeInput).toMatchObject({
      code: "A".repeat(20),
      clientIp: "198.51.100.90",
    });
    expect(result).toEqual({
      csrfToken: "B".repeat(43),
      authState: "AUTHENTICATED",
    });
    expect(response.status).toHaveBeenCalledWith(200);
  });

  test("恢复码错误映射 401，限流映射 429，管理员重认证过期映射 403", async () => {
    const service = new FakeRecoveryService();
    const controller = new MfaRecoveryController(service as never);

    service.error = new MfaRecoveryError(
      401,
      "INVALID_RECOVERY_CODE",
      "恢复码无效",
      "invalid-recovery-code",
    );
    const response = responseFixture();
    expect(
      await controller.consume(
        { headers: validHeaders(), body: undefined },
        response as never,
        { code: "A".repeat(20) },
      ),
    ).toMatchObject({ code: "INVALID_RECOVERY_CODE" });
    expect(response.status).toHaveBeenCalledWith(401);

    service.error = mfaRateLimited();
    const limited = responseFixture();
    expect(
      await controller.consume(
        { headers: validHeaders(), body: undefined },
        limited as never,
        { code: "A".repeat(20) },
      ),
    ).toMatchObject({ code: "MFA_VERIFY_RATE_LIMITED" });
    expect(limited.status).toHaveBeenCalledWith(429);

    service.error = reauthExpired();
    const expired = responseFixture();
    expect(
      await controller.rotate(
        { headers: validHeaders(), body: undefined },
        expired as never,
      ),
    ).toMatchObject({ code: "ADMIN_REAUTH_REQUIRED" });
    expect(expired.status).toHaveBeenCalledWith(403);
  });
});
