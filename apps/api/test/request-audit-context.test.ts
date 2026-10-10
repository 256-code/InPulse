/**
 * F-08 / 请求级审计上下文（纯函数与 AsyncLocalStorage 语义）。
 * 真实 HTTP 落库行为由 `audit-request-context.integration.test.ts` 覆盖。
 */
import { describe, expect, test } from "vitest";

import type { AuditWriteInput } from "../src/audit/audit.port.js";
import {
  applyRequestAuditMeta,
  clientRequestIdFromHeader,
  currentRequestAuditMeta,
  normalizeAuditIp,
  normalizeAuditUserAgent,
  requestAuditMetaFrom,
  runWithRequestAuditMeta,
  type RequestAuditMeta,
} from "../src/audit/request-audit-context.js";

function baseInput(overrides: Partial<AuditWriteInput> = {}): AuditWriteInput {
  return {
    projectId: 1,
    actorType: "USER",
    actorId: 7,
    action: "module.create",
    targetType: "MODULE",
    targetId: "5",
    eventPayload: {},
    requestId: "server-generated-request-id",
    ...overrides,
  };
}

const contextMeta: RequestAuditMeta = {
  clientRequestId: "ctx-trace-1",
  ipAddress: "10.0.0.9",
  userAgent: "ctx-agent",
};

describe("请求级审计上下文", () => {
  test("clientRequestIdFromHeader 只接受 1~64 位白名单形状，其余视为未提供", () => {
    expect(clientRequestIdFromHeader("trace-1.ab:c_d")).toBe("trace-1.ab:c_d");
    expect(clientRequestIdFromHeader("  trace-2  ")).toBe("trace-2");
    expect(clientRequestIdFromHeader("bad id")).toBeNull();
    expect(clientRequestIdFromHeader("a".repeat(64))).toBe("a".repeat(64));
    expect(clientRequestIdFromHeader("a".repeat(65))).toBeNull();
    expect(clientRequestIdFromHeader("")).toBeNull();
    expect(clientRequestIdFromHeader(undefined)).toBeNull();
  });

  test("normalizeAuditIp 只接受可解析 IP（INET 列会拒绝其它字面量）", () => {
    expect(normalizeAuditIp("127.0.0.1")).toBe("127.0.0.1");
    expect(normalizeAuditIp("::ffff:127.0.0.1")).toBe("127.0.0.1");
    expect(normalizeAuditIp(" 10.0.0.1 ")).toBe("10.0.0.1");
    expect(normalizeAuditIp("2001:db8::1")).toBe("2001:db8::1");
    expect(normalizeAuditIp("unknown")).toBeNull();
    expect(normalizeAuditIp("localhost")).toBeNull();
    expect(normalizeAuditIp("")).toBeNull();
    expect(normalizeAuditIp(undefined)).toBeNull();
  });

  test("normalizeAuditUserAgent 截断到 512 字符并把空值归一为 null", () => {
    expect(normalizeAuditUserAgent(" Mozilla/5.0 ")).toBe("Mozilla/5.0");
    expect(normalizeAuditUserAgent("y".repeat(600))).toHaveLength(512);
    expect(normalizeAuditUserAgent("   ")).toBeNull();
    expect(normalizeAuditUserAgent(undefined)).toBeNull();
  });

  test("requestAuditMetaFrom 从请求对象组装：IP 回落 socket，头缺失即留空", () => {
    expect(
      requestAuditMetaFrom({
        headers: { "x-request-id": "trace-1", "user-agent": "agent" },
        ip: "::ffff:10.1.2.3",
        socket: { remoteAddress: "10.9.9.9" },
      }),
    ).toEqual({
      clientRequestId: "trace-1",
      ipAddress: "10.1.2.3",
      userAgent: "agent",
    });

    expect(
      requestAuditMetaFrom({ socket: { remoteAddress: "2001:db8::2" } }),
    ).toEqual({
      clientRequestId: null,
      ipAddress: "2001:db8::2",
      userAgent: null,
    });

    expect(requestAuditMetaFrom({})).toEqual({
      clientRequestId: null,
      ipAddress: null,
      userAgent: null,
    });
  });

  test("applyRequestAuditMeta：显式值优先，缺省取上下文，两处都没有即留空", () => {
    expect(applyRequestAuditMeta(baseInput())).toMatchObject({
      clientRequestId: null,
      ipAddress: null,
      userAgent: null,
    });

    expect(
      applyRequestAuditMeta(
        baseInput({
          clientRequestId: "explicit",
          ipAddress: "127.0.0.1",
          userAgent: "explicit-agent",
        }),
      ),
    ).toMatchObject({
      clientRequestId: "explicit",
      ipAddress: "127.0.0.1",
      userAgent: "explicit-agent",
    });

    expect(
      runWithRequestAuditMeta(contextMeta, () =>
        applyRequestAuditMeta(baseInput()),
      ),
    ).toMatchObject({
      clientRequestId: "ctx-trace-1",
      ipAddress: "10.0.0.9",
      userAgent: "ctx-agent",
    });

    // 显式 null 保持 null，显式值仍优先于上下文。
    expect(
      runWithRequestAuditMeta(contextMeta, () =>
        applyRequestAuditMeta(
          baseInput({ clientRequestId: null, ipAddress: "127.0.0.2" }),
        ),
      ),
    ).toMatchObject({
      clientRequestId: null,
      ipAddress: "127.0.0.2",
      userAgent: "ctx-agent",
    });

    // 显式值同样经过归一化：非法 IP 留空、超长 UA 截断，不抛错。
    const normalized = runWithRequestAuditMeta(contextMeta, () =>
      applyRequestAuditMeta(
        baseInput({ ipAddress: "localhost", userAgent: "z".repeat(900) }),
      ),
    );
    expect(normalized.ipAddress).toBeNull();
    expect(normalized.userAgent).toHaveLength(512);
  });

  test("上下文只在 runWithRequestAuditMeta 内可见，不泄漏到外层", () => {
    expect(currentRequestAuditMeta()).toBeUndefined();
    runWithRequestAuditMeta(contextMeta, () => {
      expect(currentRequestAuditMeta()).toEqual(contextMeta);
    });
    expect(currentRequestAuditMeta()).toBeUndefined();
  });
});
