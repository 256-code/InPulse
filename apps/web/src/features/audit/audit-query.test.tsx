import React from "react";
import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ApiError,
  type AuditLogItem,
  type AuditLogPage,
  type InpulseApiClient,
} from "@generated/api";
import {
  AUDIT_PAGE_LIMIT,
  EMPTY_AUDIT_FILTERS,
  auditChainKey,
  describeAuditError,
  isAdminReauthRequired,
  normalizeAuditFilters,
  useAuditLogsInfiniteQuery,
  validateAuditFilters,
} from "./audit-query";

const systemItem: AuditLogItem = {
  chainId: "SYSTEM",
  sequenceNo: 12,
  projectId: null,
  actorType: "USER",
  actorId: 1,
  action: "admin.user.create",
  targetType: "USER",
  targetId: "2",
  eventPayload: { loginName: "bob" },
  requestId: "request-1",
  clientRequestId: null,
  ipAddress: "10.0.0.8",
  userAgent: "vitest",
  occurredAt: "2026-09-11T08:00:00.000Z",
  prevHash: "a".repeat(64),
  recordHash: "b".repeat(64),
  keyVersion: 1,
  canonicalVersion: "JCS-1",
};

function createQueryWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    queryClient,
    wrapper: ({ children }: { readonly children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  };
}

describe("useAuditLogsInfiniteQuery", () => {
  it("reads the SYSTEM chain and follows the signed cursor", async () => {
    const getAuditLogs = vi
      .fn()
      .mockResolvedValueOnce({
        items: [systemItem],
        nextCursor: "cursor-1",
        hasMore: true,
      } satisfies AuditLogPage)
      .mockResolvedValueOnce({
        items: [],
        nextCursor: null,
        hasMore: false,
      } satisfies AuditLogPage);
    const client = { getAuditLogs } as unknown as InpulseApiClient;
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () =>
        useAuditLogsInfiniteQuery({
          client,
          chain: { kind: "system" },
          filters: EMPTY_AUDIT_FILTERS,
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getAuditLogs).toHaveBeenCalledWith(
      { limit: AUDIT_PAGE_LIMIT },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    await act(async () => {
      await result.current.fetchNextPage();
    });
    expect(getAuditLogs).toHaveBeenLastCalledWith(
      { cursor: "cursor-1", limit: AUDIT_PAGE_LIMIT },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("sends project chain and filters in the contract shape", async () => {
    const getAuditLogs = vi.fn().mockResolvedValue({
      items: [],
      nextCursor: null,
      hasMore: false,
    } satisfies AuditLogPage);
    const client = { getAuditLogs } as unknown as InpulseApiClient;
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () =>
        useAuditLogsInfiniteQuery({
          client,
          chain: { kind: "project", projectId: 7 },
          filters: {
            action: " project.update ",
            actorId: "3",
            from: "2026-09-01T08:00",
            to: "2026-09-02T08:00",
          },
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getAuditLogs).toHaveBeenCalledWith(
      {
        projectId: 7,
        action: "project.update",
        actorId: 3,
        from: new Date("2026-09-01T08:00").toISOString(),
        to: new Date("2026-09-02T08:00").toISOString(),
        limit: AUDIT_PAGE_LIMIT,
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});

describe("audit query helpers", () => {
  it("derives the chain key without trusting client input", () => {
    expect(auditChainKey({ kind: "system" })).toBe("SYSTEM");
    expect(auditChainKey({ kind: "project", projectId: 7 })).toBe("PROJECT:7");
  });

  it("validates filters before submit", () => {
    expect(
      validateAuditFilters({ ...EMPTY_AUDIT_FILTERS, actorId: "abc" }),
    ).toBe("操作人 ID 必须是正整数。");
    expect(validateAuditFilters({ ...EMPTY_AUDIT_FILTERS, actorId: "0" })).toBe(
      "操作人 ID 必须是正整数。",
    );
    expect(
      validateAuditFilters({
        ...EMPTY_AUDIT_FILTERS,
        from: "2026-09-02T08:00",
        to: "2026-09-01T08:00",
      }),
    ).toContain("开始时间必须早于结束时间");
    expect(
      validateAuditFilters({
        action: " project.update ",
        actorId: "3",
        from: "2026-09-01T08:00",
        to: "2026-09-02T08:00",
      }),
    ).toBeNull();
  });

  it("normalizes empty filters to the contract optional shape", () => {
    expect(
      normalizeAuditFilters({ ...EMPTY_AUDIT_FILTERS, actorId: " 3 " }),
    ).toEqual({
      action: undefined,
      actorId: 3,
      from: undefined,
      to: undefined,
    });
  });

  it("maps gate errors to safe copy and detects reauthentication", () => {
    const reauth = new ApiError(403, {
      code: "ADMIN_REAUTH_REQUIRED",
      message: "internal",
      details: {},
      requestId: "r",
    });
    expect(isAdminReauthRequired(reauth)).toBe(true);
    expect(describeAuditError(reauth)).toContain("管理员安全验证");
    expect(
      describeAuditError(
        new ApiError(403, {
          code: "ADMIN_REQUIRED",
          message: "internal",
          details: {},
          requestId: "r",
        }),
      ),
    ).toBe("原始审计仅系统管理员可读取。");
    expect(
      describeAuditError(
        new ApiError(401, {
          code: "ADMIN_SESSION_REQUIRED",
          message: "internal",
          details: {},
          requestId: "r",
        }),
      ),
    ).toContain("重新登录");
    expect(
      describeAuditError(
        new ApiError(422, {
          code: "VALIDATION_FAILED",
          message: "internal",
          details: {},
          requestId: "r",
        }),
      ),
    ).toContain("游标已过期");
    expect(
      describeAuditError(
        new ApiError(429, {
          code: "RATE_LIMITED",
          message: "internal",
          details: {},
          requestId: "r",
        }),
      ),
    ).toContain("过于频繁");
    expect(describeAuditError(new Error("boom"))).toContain("暂时不可用");
    expect(isAdminReauthRequired(new Error("boom"))).toBe(false);
  });
});
