import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@generated/api";
import {
  registerSessionExpiredHandler,
  reportSessionExpired,
  resetSessionExpiredHandler,
} from "./session-recovery";

function apiError(status: number): ApiError {
  return new ApiError(status, {
    code: "ERROR",
    message: "错误",
    details: {},
    requestId: "request-id",
  });
}

afterEach(() => {
  resetSessionExpiredHandler();
});

describe("会话失效恢复", () => {
  it("401 触发会话失效处理", () => {
    const handler = vi.fn();
    registerSessionExpiredHandler(handler);

    reportSessionExpired(apiError(401));

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("403、500 与非 ApiError 错误不触发会话失效处理", () => {
    const handler = vi.fn();
    registerSessionExpiredHandler(handler);

    reportSessionExpired(apiError(403));
    reportSessionExpired(apiError(404));
    reportSessionExpired(apiError(500));
    reportSessionExpired(new Error("network down"));
    reportSessionExpired(undefined);

    expect(handler).not.toHaveBeenCalled();
  });

  it("未登记处理器时安全返回", () => {
    expect(() => reportSessionExpired(apiError(401))).not.toThrow();
  });
});
