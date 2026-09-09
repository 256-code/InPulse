import React from "react";
import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import {
  ApiError,
  type CurrentUserResponse,
  type InpulseApiClient,
} from "@generated/api";
import { AuthProvider, useAuth } from "./auth-context";

const TOTP_TEST_SECRET = "A".repeat(16);

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
        challengeMode: "totp",
      });
    });

    await waitFor(() => {
      expect(result.current.status).toBe("authenticated");
    });
    expect(client.issueCsrfToken).toHaveBeenCalledTimes(2);
    expect(client.login).toHaveBeenCalledWith(
      {
        loginName: " developer ",
        password: "secret",
        challengeMode: "totp",
      },
      { headers: { "x-csrf-token": "csrf-token" } },
    );
    expect(result.current.user).toEqual(currentUser);
  });

  it("reports MFA states without treating them as authenticated", async () => {
    const client = createClient({
      getCurrentUser: vi.fn().mockRejectedValue(createUnauthenticatedError()),
      login: vi.fn().mockResolvedValue({
        csrfToken: "login-csrf-token",
        authState: "MFA_ENROLLMENT",
      }),
    });
    const { result } = renderHook(() => useAuth(), {
      wrapper: ({ children }: { readonly children: React.ReactNode }) => (
        <AuthProvider client={client}>{children}</AuthProvider>
      ),
    });

    await waitFor(() => {
      expect(result.current.status).toBe("anonymous");
    });
    let loginResult;
    await act(async () => {
      loginResult = await result.current.login({
        loginName: "admin",
        password: "secret",
        challengeMode: "totp",
      });
    });

    expect(loginResult).toEqual({
      kind: "mfa-required",
      authState: "MFA_ENROLLMENT",
    });
    expect(result.current.status).toBe("anonymous");
    expect(client.getCurrentUser).toHaveBeenCalledTimes(1);
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

  it("keeps the MFA CSRF token and completes enrollment", async () => {
    const getCurrentUser = vi
      .fn()
      .mockRejectedValueOnce(createUnauthenticatedError())
      .mockResolvedValueOnce(currentUser);
    const client = createClient({
      getCurrentUser,
      login: vi.fn().mockResolvedValue({
        csrfToken: "login-csrf-token",
        authState: "MFA_ENROLLMENT",
        enrollmentGeneration: 0,
      }),
      startMfaEnrollment: vi.fn().mockResolvedValue({
        enrollmentGeneration: 1,
        secret: TOTP_TEST_SECRET,
        otpauthUri: `otpauth://totp/InPulse?secret=${TOTP_TEST_SECRET}`,
      }),
      confirmMfaEnrollment: vi.fn().mockResolvedValue({
        csrfToken: "confirmed-csrf-token",
        authState: "AUTHENTICATED",
        recoveryCodes: ["CODE-0001"],
      }),
    });
    const { result } = renderHook(() => useAuth(), {
      wrapper: ({ children }: { readonly children: React.ReactNode }) => (
        <AuthProvider client={client}>{children}</AuthProvider>
      ),
    });

    await waitFor(() => {
      expect(result.current.status).toBe("anonymous");
    });
    let loginResult;
    await act(async () => {
      loginResult = await result.current.login({
        loginName: "admin",
        password: "secret",
        challengeMode: "totp",
      });
    });

    expect(loginResult).toMatchObject({
      kind: "mfa-required",
      authState: "MFA_ENROLLMENT",
      enrollmentGeneration: 0,
    });
    expect(result.current.mfaState).toBe("MFA_ENROLLMENT");
    await act(async () => {
      await result.current.beginMfaEnrollment();
    });
    expect(client.startMfaEnrollment).toHaveBeenCalledWith(
      { expectedEnrollmentGeneration: 0 },
      { headers: { "x-csrf-token": "login-csrf-token" } },
    );
    expect(result.current.enrollmentGeneration).toBe(1);

    let upgradeResult;
    await act(async () => {
      upgradeResult = await result.current.confirmMfaEnrollment("123456", 1);
    });

    expect(client.confirmMfaEnrollment).toHaveBeenCalledWith(
      { expectedEnrollmentGeneration: 1, code: "123456" },
      { headers: { "x-csrf-token": "login-csrf-token" } },
    );
    expect(upgradeResult).toMatchObject({
      kind: "authenticated",
      recoveryCodes: ["CODE-0001"],
    });
    expect(result.current.status).toBe("authenticated");
    expect(result.current.pendingRecoveryCodes).toEqual(["CODE-0001"]);
  });

  it("upgrades a TOTP challenge with the rotated CSRF token", async () => {
    const getCurrentUser = vi
      .fn()
      .mockRejectedValueOnce(createUnauthenticatedError())
      .mockResolvedValueOnce(currentUser);
    const client = createClient({
      getCurrentUser,
      login: vi.fn().mockResolvedValue({
        csrfToken: "login-csrf-token",
        authState: "MFA_CHALLENGE",
      }),
      verifyMfa: vi.fn().mockResolvedValue({
        csrfToken: "verified-csrf-token",
        authState: "AUTHENTICATED",
      }),
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
      await result.current.login({
        loginName: "admin",
        password: "secret",
        challengeMode: "totp",
      });
    });
    await act(async () => {
      await result.current.verifyMfa("654321");
    });

    expect(client.verifyMfa).toHaveBeenCalledWith(
      { code: "654321" },
      { headers: { "x-csrf-token": "login-csrf-token" } },
    );
    expect(result.current.status).toBe("authenticated");
    expect(result.current.mfaState).toBeNull();
  });

  it("completes a recovery-code challenge", async () => {
    const getCurrentUser = vi
      .fn()
      .mockRejectedValueOnce(createUnauthenticatedError())
      .mockResolvedValueOnce(currentUser);
    const client = createClient({
      getCurrentUser,
      login: vi.fn().mockResolvedValue({
        csrfToken: "recovery-login-csrf",
        authState: "RECOVERY_CHALLENGE",
      }),
      consumeMfaRecoveryCode: vi.fn().mockResolvedValue({
        csrfToken: "recovery-verified-csrf",
        authState: "AUTHENTICATED",
      }),
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
      await result.current.login({
        loginName: "admin",
        password: "secret",
        challengeMode: "recovery",
      });
    });
    await act(async () => {
      await result.current.consumeMfaRecoveryCode("RECOVERY-1");
    });

    expect(client.consumeMfaRecoveryCode).toHaveBeenCalledWith(
      { code: "RECOVERY-1" },
      { headers: { "x-csrf-token": "recovery-login-csrf" } },
    );
    expect(result.current.status).toBe("authenticated");
    expect(result.current.mfaState).toBeNull();
  });

  it("issues a fresh CSRF token before admin reauthentication", async () => {
    const reauthenticateAdmin = vi.fn().mockResolvedValue(undefined);
    const client = createClient({ reauthenticateAdmin });
    const { result } = renderHook(() => useAuth(), {
      wrapper: ({ children }: { readonly children: React.ReactNode }) => (
        <AuthProvider client={client}>{children}</AuthProvider>
      ),
    });

    await waitFor(() => {
      expect(result.current.status).toBe("authenticated");
    });
    await act(async () => {
      await result.current.reauthenticateAdmin({
        password: "secret",
        code: "123456",
      });
    });

    expect(client.issueCsrfToken).toHaveBeenCalledTimes(1);
    expect(reauthenticateAdmin).toHaveBeenCalledWith(
      { password: "secret", code: "123456" },
      { headers: { "x-csrf-token": "csrf-token" } },
    );
  });
});
