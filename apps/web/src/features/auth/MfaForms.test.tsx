import React, { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ApiError,
  type CurrentUserResponse,
  type InpulseApiClient,
} from "@generated/api";
import { AuthProvider } from "./auth-context";
import { LoginForm } from "./LoginForm";

const TOTP_TEST_SECRET = "A".repeat(16);

const currentUser: CurrentUserResponse = {
  id: 1,
  loginName: "admin",
  name: "管理员",
  email: null,
  avatarUrl: null,
  isAdmin: true,
  status: "ACTIVE",
};

function createUnauthenticatedError(): ApiError {
  return new ApiError(401, {
    code: "UNAUTHENTICATED",
    message: "登录状态无效",
    details: {},
    requestId: "request-id",
  });
}

function createClient(
  overrides: Partial<InpulseApiClient> = {},
): InpulseApiClient {
  return {
    getCurrentUser: vi
      .fn()
      .mockRejectedValueOnce(createUnauthenticatedError())
      .mockResolvedValueOnce(currentUser),
    issueCsrfToken: vi.fn().mockResolvedValue({ csrfToken: "csrf-token" }),
    login: vi.fn().mockResolvedValue({
      csrfToken: "login-csrf-token",
      authState: "MFA_ENROLLMENT",
      enrollmentGeneration: 0,
    }),
    logout: vi.fn().mockResolvedValue(undefined),
    startMfaEnrollment: vi.fn().mockResolvedValue({
      enrollmentGeneration: 1,
      secret: TOTP_TEST_SECRET,
      otpauthUri: `otpauth://totp/InPulse?secret=${TOTP_TEST_SECRET}`,
    }),
    confirmMfaEnrollment: vi.fn().mockResolvedValue({
      csrfToken: "confirmed-csrf-token",
      authState: "AUTHENTICATED",
      recoveryCodes: ["CODE-0001", "CODE-0002"],
    }),
    verifyMfa: vi.fn().mockResolvedValue({
      csrfToken: "verified-csrf-token",
      authState: "AUTHENTICATED",
    }),
    consumeMfaRecoveryCode: vi.fn().mockResolvedValue({
      csrfToken: "recovery-csrf-token",
      authState: "AUTHENTICATED",
    }),
    ...overrides,
  } as unknown as InpulseApiClient;
}

async function submitCredentials(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("登录名"), "admin");
  await user.type(screen.getByLabelText("密码"), "secret");
  await user.click(screen.getByRole("button", { name: /^登\s*录$/ }));
}

describe("LoginForm MFA flows", () => {
  it("registers TOTP, shows recovery codes once and completes login", async () => {
    const user = userEvent.setup();
    const onAuthenticated = vi.fn();
    const client = createClient();

    render(
      <StrictMode>
        <AuthProvider client={client}>
          <LoginForm onAuthenticated={onAuthenticated} />
        </AuthProvider>
      </StrictMode>,
    );

    await submitCredentials(user);
    expect(await screen.findByLabelText("验证器账户密钥")).toHaveValue(
      TOTP_TEST_SECRET,
    );
    expect(client.startMfaEnrollment).toHaveBeenCalledTimes(1);
    expect(client.startMfaEnrollment).toHaveBeenCalledWith(
      { expectedEnrollmentGeneration: 0 },
      { headers: { "x-csrf-token": "login-csrf-token" } },
    );

    await user.type(screen.getByLabelText("6 位验证码"), "123456");
    await user.click(screen.getByRole("button", { name: "确认并启用" }));

    expect(
      await screen.findByText("TOTP 已启用，请立即保存恢复码"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("recovery-codes")).toHaveTextContent("CODE-0001");
    expect(client.confirmMfaEnrollment).toHaveBeenCalledWith(
      { expectedEnrollmentGeneration: 1, code: "123456" },
      { headers: { "x-csrf-token": "login-csrf-token" } },
    );

    await user.click(screen.getByRole("button", { name: "完成并进入系统" }));
    expect(onAuthenticated).toHaveBeenCalledTimes(1);
  });

  it("completes a TOTP challenge after password login", async () => {
    const user = userEvent.setup();
    const onAuthenticated = vi.fn();
    const client = createClient({
      login: vi.fn().mockResolvedValue({
        csrfToken: "login-csrf-token",
        authState: "MFA_CHALLENGE",
      }),
    });

    render(
      <StrictMode>
        <AuthProvider client={client}>
          <LoginForm onAuthenticated={onAuthenticated} />
        </AuthProvider>
      </StrictMode>,
    );

    await submitCredentials(user);
    expect(await screen.findByText("需要完成 TOTP 验证")).toBeInTheDocument();
    await user.type(screen.getByLabelText("6 位验证码"), "654321");
    await user.click(screen.getByRole("button", { name: "验证并进入系统" }));

    await waitFor(() => {
      expect(onAuthenticated).toHaveBeenCalledTimes(1);
    });
    expect(client.verifyMfa).toHaveBeenCalledWith(
      { code: "654321" },
      { headers: { "x-csrf-token": "login-csrf-token" } },
    );
  });

  it("completes a recovery-code challenge when selected before login", async () => {
    const user = userEvent.setup();
    const onAuthenticated = vi.fn();
    const client = createClient({
      login: vi.fn().mockResolvedValue({
        csrfToken: "recovery-login-csrf",
        authState: "RECOVERY_CHALLENGE",
      }),
    });

    render(
      <AuthProvider client={client}>
        <LoginForm onAuthenticated={onAuthenticated} />
      </AuthProvider>,
    );

    await user.click(screen.getByRole("checkbox", { name: /使用恢复码登录/ }));
    await submitCredentials(user);
    expect(await screen.findByText("需要完成恢复码验证")).toBeInTheDocument();
    await user.type(screen.getByLabelText("恢复码"), "RECOVERY-0001");
    await user.click(
      screen.getByRole("button", { name: "验证恢复码并进入系统" }),
    );

    await waitFor(() => {
      expect(onAuthenticated).toHaveBeenCalledTimes(1);
    });
    expect(client.consumeMfaRecoveryCode).toHaveBeenCalledWith(
      { code: "RECOVERY-0001" },
      { headers: { "x-csrf-token": "recovery-login-csrf" } },
    );
  });

  it("shows a safe validation error instead of exposing the server message", async () => {
    const user = userEvent.setup();
    const client = createClient({
      login: vi.fn().mockResolvedValue({
        csrfToken: "login-csrf-token",
        authState: "MFA_CHALLENGE",
      }),
      verifyMfa: vi.fn().mockRejectedValue(
        new ApiError(401, {
          code: "INVALID_TOTP_CODE",
          message: "internal-totp-detail",
          details: {},
          requestId: "request-id",
        }),
      ),
    });

    render(
      <AuthProvider client={client}>
        <LoginForm />
      </AuthProvider>,
    );

    await submitCredentials(user);
    expect(await screen.findByText("需要完成 TOTP 验证")).toBeInTheDocument();
    await user.type(screen.getByLabelText("6 位验证码"), "000000");
    await user.click(screen.getByRole("button", { name: "验证并进入系统" }));

    expect(
      await screen.findByText("验证码无效或已使用，请输入当前 6 位验证码。"),
    ).toBeInTheDocument();
    expect(screen.queryByText("internal-totp-detail")).not.toBeInTheDocument();
  });
});
