import { describe, expect, test, vi } from "vitest";

import { MeController } from "../src/auth/me.controller.js";
import type { CurrentUserProfile } from "../src/auth/user-profile.repository.js";

class FakeMeService {
  profile: CurrentUserProfile | undefined = {
    id: 7,
    loginName: "alice",
    name: "Alice",
    email: "alice@example.com",
    avatarUrl: null,
    isAdmin: false,
    status: "ACTIVE",
  };
  error: Error | undefined;
  calls = 0;

  async getCurrentUser(): Promise<CurrentUserProfile | undefined> {
    this.calls += 1;
    if (this.error !== undefined) {
      throw this.error;
    }
    return this.profile;
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

function requestFixture(cookie: string | undefined) {
  return {
    headers: cookie === undefined ? {} : { cookie },
  };
}

describe("MeController", () => {
  test("有效身份返回当前用户资料并禁用缓存", async () => {
    const service = new FakeMeService();
    const controller = new MeController(service as never);
    const response = responseFixture();

    const result = await controller.getCurrentUser(
      requestFixture("__Host-session=token") as never,
      response as never,
    );

    expect(service.calls).toBe(1);
    expect(result).toEqual(service.profile);
    expect(response.headers["Cache-Control"]).toBe("no-store");
  });

  test("身份无效时返回统一 401 信封", async () => {
    const service = new FakeMeService();
    service.profile = undefined;
    const controller = new MeController(service as never);
    const response = responseFixture();

    const result = await controller.getCurrentUser(
      requestFixture(undefined) as never,
      response as never,
    );

    expect(response.status).toHaveBeenCalledWith(401);
    expect(result).toMatchObject({ code: "UNAUTHENTICATED" });
    expect(response.headers["Cache-Control"]).toBe("no-store");
  });

  test("未预期错误返回统一 500 信封且不泄露内部细节", async () => {
    const service = new FakeMeService();
    service.error = new Error("secret details");
    const controller = new MeController(service as never);
    const response = responseFixture();

    const result = await controller.getCurrentUser(
      requestFixture("__Host-session=token") as never,
      response as never,
    );

    expect(response.status).toHaveBeenCalledWith(500);
    expect(result).toMatchObject({ code: "INTERNAL_ERROR" });
    expect(JSON.stringify(result)).not.toContain("secret details");
  });
});
