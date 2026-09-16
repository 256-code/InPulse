import React from "react";
import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import {
  ApiError,
  type CurrentUserResponse,
  type InpulseApiClient,
} from "@generated/api";
import { AuthProvider, useAuth } from "./auth-context";

const currentUser: CurrentUserResponse = {
  id: 1,
  loginName: "developer",
  name: "开发者 C",
  email: null,
  avatarUrl: null,
  isAdmin: false,
  status: "ACTIVE",
};

function createClient(
  overrides: Partial<InpulseApiClient> = {},
): InpulseApiClient {
  return {
    getCurrentUser: vi.fn().mockResolvedValue(currentUser),
    issueCsrfToken: vi.fn().mockResolvedValue({ csrfToken: "csrf-token" }),
    login: vi.fn().mockResolvedValue({
      csrfToken: "login-csrf-token",
      authState: "AUTHENTICATED",
    }),
    logout: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as InpulseApiClient;
}

function createUnauthenticatedError(): ApiError {
  return new ApiError(401, {
    code: "UNAUTHENTICATED",
    message: "登录状态无效",
    details: {},
    requestId: "request-id",
  });
}

function createServerError(): ApiError {
  return new ApiError(500, {
    code: "INTERNAL_ERROR",
    message: "服务器错误",
    details: {},
    requestId: "request-id",
  });
}

describe("AuthProvider", () => {
  it("restores the current user from the server on mount", async () => {
    const client = createClient();
    const { result } = renderHook(() => useAuth(), {
      wrapper: ({ children }: { readonly children: React.ReactNode }) => (
        <AuthProvider client={client}>{children}</AuthProvider>
      ),
    });

    await waitFor(() => {
      expect(result.current.status).toBe("authenticated");
    });
    expect(result.current.user).toEqual(currentUser);
  });

  it("bootstraps an anonymous session when the server returns 401", async () => {
    const client = createClient({
      getCurrentUser: vi.fn().mockRejectedValue(createUnauthenticatedError()),
    });
    const { result } = renderHook(() => useAuth(), {
      wrapper: ({ children }: { readonly children: React.ReactNode }) => (
        <AuthProvider client={client}>{children}</AuthProvider>
      ),
    });

    await waitFor(() => {
      expect(result.current.status).toBe("anonymous");
    });
    expect(result.current.user).toBeNull();
    expect(client.issueCsrfToken).toHaveBeenCalledTimes(1);
  });

  it("issues CSRF, logs in and restores the authenticated user", async () => {
    const getCurrentUser = vi
      .fn()
      .mockRejectedValueOnce(createUnauthenticatedError())
      .mockResolvedValueOnce(currentUser);
    const client = createClient({ getCurrentUser });
    const { result } = renderHook(() => useAuth(), {
      wrapper: ({ children }: { readonly children: React.ReactNode }) => (
        <AuthProvider client={client}>{children}</AuthProvider>
      ),
    });

    await waitFor(() => {
      expect(result.current.status).toBe("anonymous");
    });
    await act(async () => {
      await result.current.login({
        loginName: " developer ",
        password: "secret",
      });
    });

    await waitFor(() => {
      expect(result.current.status).toBe("authenticated");
    });
    expect(client.issueCsrfToken).toHaveBeenCalledTimes(2);
    expect(client.login).toHaveBeenCalledWith(
      { loginName: " developer ", password: "secret" },
      { headers: { "x-csrf-token": "csrf-token" } },
    );
    expect(result.current.user).toEqual(currentUser);
  });

  it("keeps the anonymous state when credentials are rejected", async () => {
    const client = createClient({
      getCurrentUser: vi.fn().mockRejectedValue(createUnauthenticatedError()),
      login: vi.fn().mockRejectedValue(createUnauthenticatedError()),
    });
    const { result } = renderHook(() => useAuth(), {
      wrapper: ({ children }: { readonly children: React.ReactNode }) => (
        <AuthProvider client={client}>{children}</AuthProvider>
      ),
    });

    await waitFor(() => {
      expect(result.current.status).toBe("anonymous");
    });
    await act(async () => {
      await expect(
        result.current.login({ loginName: "admin", password: "wrong" }),
      ).rejects.toBeInstanceOf(ApiError);
    });

    expect(result.current.status).toBe("anonymous");
    expect(result.current.user).toBeNull();
    expect(result.current.errorMessage).toBeNull();
  });

  it("maps an unexpected login failure to the error state", async () => {
    const client = createClient({
      getCurrentUser: vi.fn().mockRejectedValue(createUnauthenticatedError()),
      login: vi.fn().mockRejectedValue(createServerError()),
    });
    const { result } = renderHook(() => useAuth(), {
      wrapper: ({ children }: { readonly children: React.ReactNode }) => (
        <AuthProvider client={client}>{children}</AuthProvider>
      ),
    });

    await waitFor(() => {
      expect(result.current.status).toBe("anonymous");
    });
    await act(async () => {
      await expect(
        result.current.login({ loginName: "admin", password: "secret" }),
      ).rejects.toBeInstanceOf(ApiError);
    });

    expect(result.current.status).toBe("error");
    expect(result.current.errorMessage).toBe(
      "服务器暂时无法完成登录，请稍后重试。",
    );
  });

  it("logs out with a fresh CSRF token and clears local state", async () => {
    const client = createClient();
    const { result } = renderHook(() => useAuth(), {
      wrapper: ({ children }: { readonly children: React.ReactNode }) => (
        <AuthProvider client={client}>{children}</AuthProvider>
      ),
    });

    await waitFor(() => {
      expect(result.current.status).toBe("authenticated");
    });
    await act(async () => {
      await result.current.logout();
    });

    expect(result.current.status).toBe("anonymous");
    expect(result.current.user).toBeNull();
    expect(client.logout).toHaveBeenCalledWith({
      headers: { "x-csrf-token": "csrf-token" },
    });
  });
});
