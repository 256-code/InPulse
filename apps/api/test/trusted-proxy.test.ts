import { describe, expect, test } from "vitest";

import { trustedProxySetting } from "../src/trusted-proxy.js";

describe("trustedProxySetting", () => {
  test("未配置时只信任 loopback", () => {
    expect(trustedProxySetting(undefined)).toBe("loopback");
    expect(trustedProxySetting("  ,  ")).toBe("loopback");
  });

  test("接受显式 IPv4/IPv6 与 CIDR", () => {
    expect(trustedProxySetting("127.0.0.1, ::1, 10.0.0.0/8, fd00::/8")).toBe(
      "127.0.0.1, ::1, 10.0.0.0/8, fd00::/8",
    );
  });

  test("非法地址或前缀 fail closed", () => {
    expect(() => trustedProxySetting("example.com")).toThrow();
    expect(() => trustedProxySetting("10.0.0.0/129")).toThrow();
    expect(() => trustedProxySetting("10.0.0.0/33")).toThrow();
    expect(() => trustedProxySetting("10.0.0.0/abc")).toThrow();
  });
});
