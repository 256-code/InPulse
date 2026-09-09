import { describe, expect, test, vi } from "vitest";

import { HealthController } from "../src/health/health.controller.js";
import type { HealthService } from "../src/health/health.service.js";

function serviceFixture({ ready = true }: { readonly ready?: boolean } = {}): {
  readonly service: HealthService;
  readonly checkReadiness: ReturnType<typeof vi.fn>;
} {
  const checkReadiness = vi.fn(async () => {
    if (!ready) {
      throw new Error("database unavailable");
    }
  });
  const service = { checkReadiness } as unknown as HealthService;
  return { service, checkReadiness };
}

function responseFixture(): {
  readonly status: ReturnType<typeof vi.fn>;
} {
  return { status: vi.fn(() => undefined) };
}

describe("HealthController", () => {
  test("GET /health 返回 ok", () => {
    const controller = new HealthController(serviceFixture().service);
    expect(controller.check()).toEqual({ status: "ok" });
  });

  test("GET /health/live 返回 ok 且不访问数据库", () => {
    const { service, checkReadiness } = serviceFixture();
    const controller = new HealthController(service);
    expect(controller.live()).toEqual({ status: "ok" });
    expect(checkReadiness).not.toHaveBeenCalled();
  });

  test("GET /health/ready 数据库与迁移正常时返回 ok", async () => {
    const { service } = serviceFixture({ ready: true });
    const controller = new HealthController(service);
    const response = responseFixture();
    await expect(controller.ready(response as never)).resolves.toEqual({
      status: "ok",
    });
    expect(response.status).not.toHaveBeenCalled();
  });

  test("GET /health/ready 检查失败时返回 503 与统一错误体", async () => {
    const { service, checkReadiness } = serviceFixture({ ready: false });
    const controller = new HealthController(service);
    const response = responseFixture();
    const result = await controller.ready(response as never);
    expect(checkReadiness).toHaveBeenCalledTimes(1);
    expect(response.status).toHaveBeenCalledWith(503);
    expect(result).toMatchObject({
      code: "SERVICE_NOT_READY",
      message: expect.any(String) as string,
      details: {},
      requestId: expect.any(String) as string,
    });
  });
});
