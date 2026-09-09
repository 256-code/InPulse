import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ApiError,
  type AdminUserItem,
  type InpulseApiClient,
} from "@generated/api";
import { adminUserErrorMessage, useAdminUsers } from "./admin-user-query";

const user: AdminUserItem = {
  id: 9,
  loginName: "alice",
  name: "Alice",
  email: "alice@example.com",
  avatarUrl: null,
  isAdmin: true,
  status: "ACTIVE",
  rowVersion: 3,
  disabledAt: null,
  createdAt: "2026-09-09T00:00:00.000Z",
  updatedAt: "2026-09-09T00:00:00.000Z",
};

function wrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { readonly children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("admin user query", () => {
  it("reads the generated admin user list", async () => {
    const listAdminUsers = vi.fn().mockResolvedValue({ items: [user] });
    const client = { listAdminUsers } as unknown as InpulseApiClient;
    const { result } = renderHook(() => useAdminUsers(client), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
    expect(listAdminUsers).toHaveBeenCalledTimes(1);
    expect(result.current.query.data?.items).toEqual([user]);
  });

  it("sends CSRF, idempotency key and If-Match on a versioned write", async () => {
    const listAdminUsers = vi.fn().mockResolvedValue({ items: [user] });
    const issueCsrfToken = vi
      .fn()
      .mockResolvedValue({ csrfToken: "a".repeat(43) });
    const updateUser = vi
      .fn()
      .mockResolvedValue({ ...user, name: "Alice Updated", rowVersion: 4 });
    const client = {
      listAdminUsers,
      issueCsrfToken,
      updateUser,
    } as unknown as InpulseApiClient;
    const { result } = renderHook(() => useAdminUsers(client), {
      wrapper: wrapper(),
    });
    await result.current.mutation.mutateAsync({
      action: "update",
      user,
      body: { name: "Alice Updated" },
    });
    expect(issueCsrfToken).toHaveBeenCalledTimes(1);
    expect(updateUser).toHaveBeenCalledWith(
      9,
      { name: "Alice Updated" },
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-csrf-token": "a".repeat(43),
          "Idempotency-Key": expect.stringContaining("admin-user-"),
          "If-Match": '"3"',
        }),
      }),
    );
  });

  it("maps admin reauth, conflict and permission errors without leaking internals", () => {
    const reauth = new ApiError(403, {
      code: "ADMIN_REAUTH_REQUIRED",
      message: "internal-reauth",
      details: {},
      requestId: "r",
    });
    const version = new ApiError(409, {
      code: "ADMIN_USER_VERSION_CONFLICT",
      message: "internal-version",
      details: {},
      requestId: "v",
    });
    const forbidden = new ApiError(403, {
      code: "ADMIN_FORBIDDEN",
      message: "internal-forbidden",
      details: {},
      requestId: "f",
    });
    expect(adminUserErrorMessage(reauth)).toBe(
      "请先完成管理员安全验证，再重新提交。",
    );
    expect(adminUserErrorMessage(version)).toContain("加载最新版本");
    expect(adminUserErrorMessage(forbidden)).not.toContain(
      "internal-forbidden",
    );
  });
});
