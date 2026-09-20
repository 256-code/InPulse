import { describe, expect, test } from "vitest";

import {
  DEFAULT_SESSION_IDLE_MAX_AGE_SECONDS,
  sessionTtlPolicyFromEnv,
} from "../src/auth/session-ttl.policy.js";
import { SESSION_ABSOLUTE_MAX_AGE_SECONDS } from "../src/auth/csrf.http.js";

describe("本地会话有效期策略（ADR-038）", () => {
  test("默认空闲有效期 2 小时、绝对有效期 7 天", () => {
    const policy = sessionTtlPolicyFromEnv({});
    expect(policy.idleMaxAgeSeconds).toBe(7200);
    expect(DEFAULT_SESSION_IDLE_MAX_AGE_SECONDS).toBe(7200);
    expect(policy.absoluteMaxAgeSeconds).toBe(SESSION_ABSOLUTE_MAX_AGE_SECONDS);
  });

  test("允许用环境变量覆盖空闲有效期", () => {
    expect(
      sessionTtlPolicyFromEnv({ SESSION_IDLE_MAX_AGE_SECONDS: " 600 " })
        .idleMaxAgeSeconds,
    ).toBe(600);
  });

  test("非法取值必须启动失败而不是静默降级", () => {
    expect(() =>
      sessionTtlPolicyFromEnv({ SESSION_IDLE_MAX_AGE_SECONDS: "0" }),
    ).toThrow();
    expect(() =>
      sessionTtlPolicyFromEnv({ SESSION_IDLE_MAX_AGE_SECONDS: "-60" }),
    ).toThrow();
    expect(() =>
      sessionTtlPolicyFromEnv({ SESSION_IDLE_MAX_AGE_SECONDS: "30m" }),
    ).toThrow();
  });
});
