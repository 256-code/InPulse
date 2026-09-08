import { describe, expect, test } from "vitest";

import {
  PREAUTH_COOKIE_NAME,
  PREAUTH_MAX_AGE_SECONDS,
  buildCookie,
  mutationSameOriginValidationError,
  parseCookieHeader,
  sameOriginValidationError,
} from "../src/auth/csrf.http.js";

describe("CSRF HTTP 安全辅助", () => {
  test("解析 Cookie 并忽略未匹配项", () => {
    expect(
      parseCookieHeader(
        `other=1; ${PREAUTH_COOKIE_NAME}=token-123; last=x`,
        PREAUTH_COOKIE_NAME,
      ),
    ).toBe("token-123");
    expect(
      parseCookieHeader(`${PREAUTH_COOKIE_NAME}=`, PREAUTH_COOKIE_NAME),
    ).toBe(undefined);
    expect(parseCookieHeader(undefined, PREAUTH_COOKIE_NAME)).toBe(undefined);
  });

  test("预认证 Cookie 只带安全属性与受限 Max-Age", () => {
    const cookie = buildCookie({
      name: PREAUTH_COOKIE_NAME,
      value: "token",
      maxAgeSeconds: PREAUTH_MAX_AGE_SECONDS,
    });
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain(`Max-Age=${PREAUTH_MAX_AGE_SECONDS}`);
    expect(cookie).not.toContain("Domain=");
  });

  test("清 Cookie 使用 Max-Age=0", () => {
    const cookie = buildCookie({
      name: PREAUTH_COOKIE_NAME,
      value: null,
      maxAgeSeconds: 0,
    });
    expect(cookie).toContain("Max-Age=0");
  });

  test("Origin/Referer 缺失不拒绝，存在时精确校验", () => {
    expect(sameOriginValidationError({})).toBeUndefined();
    expect(
      sameOriginValidationError({
        host: "localhost:5173",
        origin: "http://localhost:5173",
      }),
    ).toBeUndefined();
    expect(
      sameOriginValidationError({
        host: "localhost:5173",
        referer: "http://localhost:5173/login",
      }),
    ).toBeUndefined();
    expect(
      sameOriginValidationError({
        host: "localhost:5173",
        origin: "https://evil.example",
      }),
    ).toBe("cross-origin");
    expect(sameOriginValidationError({ origin: "http://localhost:5173" })).toBe(
      "missing-host",
    );
  });

  test("非安全请求 Origin/Referer 至少存在一个", () => {
    expect(mutationSameOriginValidationError({})).toBe(
      "missing-origin-and-referer",
    );
    expect(
      mutationSameOriginValidationError({
        host: "localhost:5173",
        referer: "http://localhost:5173/login",
      }),
    ).toBeUndefined();
    expect(
      mutationSameOriginValidationError({
        host: "localhost:5173",
        origin: "https://evil.example",
      }),
    ).toBe("cross-origin");
  });

  test("Fetch Metadata 存在时必须通过允许值", () => {
    expect(
      sameOriginValidationError({
        host: "localhost:5173",
        origin: "http://localhost:5173",
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "cors",
        "sec-fetch-dest": "empty",
      }),
    ).toBeUndefined();
    expect(
      sameOriginValidationError({
        host: "localhost:5173",
        "sec-fetch-site": "cross-site",
      }),
    ).toBe("cross-site");
    expect(
      sameOriginValidationError({
        host: "localhost:5173",
        "sec-fetch-mode": "no-cors",
      }),
    ).toBe("unsupported-sec-fetch-mode");
  });
});
