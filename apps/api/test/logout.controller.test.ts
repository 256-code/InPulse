import { describe, expect, test, vi } from "vitest";

import { LogoutController } from "../src/auth/logout.controller.js";
import { LogoutError } from "../src/auth/logout.error.js";
import type { LogoutResult } from "../src/auth/logout.service.js";

class FakeLogoutService {
  result: LogoutResult = {
    cookies: [
      { name: "__Host-preauth", value: null, maxAgeSeconds: 0 },
      { name: "__Host-session", value: null, maxAgeSeconds: 0 },
    ],
  };
  error: LogoutError | undefined;
  calls = 0;

  async logout(): Promise<LogoutResult> {
    this.calls += 1;
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

function requestFixture(headers: Readonly<Record<string, string>> = {}): {
  readonly headers: Readonly<Record<string, string>>;
} {
  return { headers };
}

describe("LogoutController", () => {
  test("Origin/Referer 均缺失时返回 403 且不调用服务", async () => {
    const service = new FakeLogoutService();
    const controller = new LogoutController(service as never);
    const response = responseFixture();

    const result = await controller.logout(requestFixture(), response as never);

    expect(response.status).toHaveBeenCalledWith(403);
    expect(result).toMatchObject({ code: "CSRF_ORIGIN_REJECTED" });
    expect(service.calls).toBe(0);
  });

  test("同源请求成功返回 204、清 Cookie 且禁止缓存", async () => {
    const service = new FakeLogoutService();
    const controller = new LogoutController(service as never);
    const response = responseFixture();

    const result = await controller.logout(
      requestFixture({
        host: "localhost",
        origin: "http://localhost",
        cookie: "__Host-session=token",
        "x-csrf-token": "A".repeat(43),
      }),
      response as never,
    );

    expect(service.calls).toBe(1);
    expect(result).toBeUndefined();
    expect(response.status).toHaveBeenCalledWith(204);
    expect(response.headers["Cache-Control"]).toBe("no-store");
    expect(response.headers["Set-Cookie"]).toHaveLength(2);
  });

  test("LogoutError 映射为统一错误信封", async () => {
    const service = new FakeLogoutService();
    service.error = new LogoutError(
      403,
      "CSRF_TOKEN_INVALID",
      "Session CSRF Token 无效",
      "invalid-csrf",
    );
    const controller = new LogoutController(service as never);
    const response = responseFixture();

    const result = await controller.logout(
      requestFixture({
        host: "localhost",
        origin: "http://localhost",
        cookie: "__Host-session=token",
        "x-csrf-token": "A".repeat(43),
      }),
      response as never,
    );

    expect(response.status).toHaveBeenCalledWith(403);
    expect(result).toMatchObject({
      code: "CSRF_TOKEN_INVALID",
      details: { reason: "invalid-csrf" },
    });
  });
});
