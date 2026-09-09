import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError, type InpulseApiClient } from "@generated/api";
import { AuthProvider } from "./auth-context";
import { AdminReauthenticateModal } from "./AdminReauthenticateModal";

function createClient(
  overrides: Partial<InpulseApiClient> = {},
): InpulseApiClient {
  return {
    getCurrentUser: vi.fn().mockResolvedValue({
      id: 1,
      loginName: "admin",
      name: "管理员",
      email: null,
      avatarUrl: null,
      isAdmin: true,
      status: "ACTIVE",
    }),
    issueCsrfToken: vi.fn().mockResolvedValue({ csrfToken: "csrf-token" }),
    reauthenticateAdmin: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as InpulseApiClient;
}

describe("AdminReauthenticateModal", () => {
  it("calls reauthentication with password and TOTP and reports success", async () => {
    const user = userEvent.setup();
    const reauthenticateAdmin = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    const client = createClient({ reauthenticateAdmin });

    render(
      <AuthProvider client={client}>
        <AdminReauthenticateModal
          open
          onClose={onClose}
          onSuccess={onSuccess}
        />
      </AuthProvider>,
    );

    await user.type(screen.getByLabelText("管理员密码"), "secret");
    await user.type(screen.getByLabelText("6 位验证码"), "123456");
    await user.click(screen.getByRole("button", { name: "验证身份" }));

    expect(await screen.findByText("重认证成功")).toBeInTheDocument();
    expect(reauthenticateAdmin).toHaveBeenCalledWith(
      { password: "secret", code: "123456" },
      { headers: { "x-csrf-token": "csrf-token" } },
    );
    expect(onSuccess).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: /完\s*成/ }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows a safe error without leaking the server message", async () => {
    const user = userEvent.setup();
    const client = createClient({
      reauthenticateAdmin: vi.fn().mockRejectedValue(
        new ApiError(401, {
          code: "INVALID_PASSWORD",
          message: "internal-password-detail",
          details: {},
          requestId: "request-id",
        }),
      ),
    });
    const onClose = vi.fn();

    render(
      <AuthProvider client={client}>
        <AdminReauthenticateModal open onClose={onClose} />
      </AuthProvider>,
    );

    await user.type(screen.getByLabelText("管理员密码"), "wrong");
    await user.type(screen.getByLabelText("6 位验证码"), "123456");
    await user.click(screen.getByRole("button", { name: "验证身份" }));

    expect(await screen.findByText("管理员密码不正确。")).toBeInTheDocument();
    expect(
      screen.queryByText("internal-password-detail"),
    ).not.toBeInTheDocument();
    await waitFor(() => {
      expect(onClose).not.toHaveBeenCalled();
    });
  });
});
