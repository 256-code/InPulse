import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError, type InpulseApiClient } from "@generated/api";
import { AuthProvider } from "./auth-context";
import { LoginForm } from "./LoginForm";

function createUnauthenticatedError(): ApiError {
  return new ApiError(401, {
    code: "UNAUTHENTICATED",
    message: "登录状态无效",
    details: {},
    requestId: "request-id",
  });
}

function createClient(options: {
  readonly login?: InpulseApiClient["login"];
  readonly getCurrentUser?: InpulseApiClient["getCurrentUser"];
}): InpulseApiClient {
  return {
    getCurrentUser:
      options.getCurrentUser ??
      vi.fn().mockRejectedValue(createUnauthenticatedError()),
    issueCsrfToken: vi.fn().mockResolvedValue({ csrfToken: "csrf-token" }),
    login:
      options.login ??
      vi.fn().mockResolvedValue({
        csrfToken: "login-csrf-token",
        authState: "AUTHENTICATED",
      }),
    logout: vi.fn().mockResolvedValue(undefined),
  } as unknown as InpulseApiClient;
}

describe("LoginForm", () => {
  it("shows a safe message when credentials are rejected", async () => {
    const login = vi.fn().mockRejectedValue(createUnauthenticatedError());
    const client = createClient({ login });
    const user = userEvent.setup();
    const rejectedPassword = "wrong-password";

    render(
      <AuthProvider client={client}>
        <LoginForm />
      </AuthProvider>,
    );

    await user.type(screen.getByLabelText("登录名"), "developer");
    await user.type(screen.getByLabelText("密码"), rejectedPassword);
    await user.click(screen.getByRole("button", { name: /登\s*录/ }));

    expect(
      await screen.findByText(
        "登录名或密码不正确，或登录状态已失效，请刷新页面后重试。",
      ),
    ).toBeInTheDocument();
    expect(login).toHaveBeenCalledWith(
      {
        loginName: "developer",
        password: rejectedPassword,
        challengeMode: "totp",
      },
      { headers: { "x-csrf-token": "csrf-token" } },
    );
  });

  it("invokes onAuthenticated after a successful login", async () => {
    const getCurrentUser = vi
      .fn()
      .mockRejectedValueOnce(createUnauthenticatedError())
      .mockResolvedValue({
        id: 1,
        loginName: "developer",
        name: "开发者 C",
        email: null,
        avatarUrl: null,
        isAdmin: false,
        status: "ACTIVE",
      });
    const client = createClient({ getCurrentUser });
    const onAuthenticated = vi.fn();
    const user = userEvent.setup();

    render(
      <AuthProvider client={client}>
        <LoginForm onAuthenticated={onAuthenticated} />
      </AuthProvider>,
    );

    await user.type(screen.getByLabelText("登录名"), "developer");
    await user.type(screen.getByLabelText("密码"), "secret");
    await user.click(screen.getByRole("button", { name: /登\s*录/ }));

    await waitFor(() => {
      expect(onAuthenticated).toHaveBeenCalledTimes(1);
    });
  });
});
