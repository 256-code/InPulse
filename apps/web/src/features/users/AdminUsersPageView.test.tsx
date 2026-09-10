import React from "react";
import { ConfigProvider } from "antd";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
  ApiError,
  type AdminUserItem,
  type InpulseApiClient,
} from "@generated/api";
import { AuthStateProvider } from "@features/auth/auth-context";
import { AdminUsersPageView } from "./AdminUsersPageView";

const admin: AdminUserItem = {
  id: 1,
  loginName: "alice",
  name: "Alice",
  email: "alice@example.com",
  avatarUrl: null,
  isAdmin: true,
  status: "ACTIVE",
  rowVersion: 1,
  disabledAt: null,
  createdAt: "2026-09-09T00:00:00.000Z",
  updatedAt: "2026-09-09T00:00:00.000Z",
};

const member: AdminUserItem = {
  ...admin,
  id: 2,
  loginName: "bob",
  name: "Bob",
  email: "bob@example.com",
  isAdmin: false,
  rowVersion: 1,
};

const ADMIN_USER_INITIAL_PASSWORD = "initial-password";

function mount(
  client: InpulseApiClient,
  currentUserId = 1,
  authValue: {
    readonly reauthenticateAdmin?: () => Promise<void>;
  } = {},
) {
  return render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <AuthStateProvider value={authValue}>
        <QueryClientProvider
          client={
            new QueryClient({ defaultOptions: { queries: { retry: false } } })
          }
        >
          <AdminUsersPageView client={client} currentUserId={currentUserId} />
        </QueryClientProvider>
      </AuthStateProvider>
    </ConfigProvider>,
  );
}

function userCard(name: string): HTMLElement {
  const card = screen.getByText(name).closest(".member-row");
  if (!card) throw new Error(`user card not found: ${name}`);
  return card as HTMLElement;
}

describe("F-03 admin users page", () => {
  it("lists users and hides self disable/force-logout actions", async () => {
    const listAdminUsers = vi
      .fn()
      .mockResolvedValue({ items: [admin, member] });
    mount({ listAdminUsers } as unknown as InpulseApiClient);
    await screen.findByText("Alice");
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(
      within(userCard("Alice")).queryByRole("button", { name: /停\s*用/ }),
    ).not.toBeInTheDocument();
    expect(
      within(userCard("Alice")).queryByRole("button", { name: "强制退出" }),
    ).not.toBeInTheDocument();
    expect(
      within(userCard("Bob")).getByRole("button", { name: /停\s*用/ }),
    ).toBeInTheDocument();
    expect(
      within(userCard("Bob")).getByRole("button", { name: "强制退出" }),
    ).toBeInTheDocument();
  });

  it("creates a user through the generated client with CSRF and idempotency headers", async () => {
    const listAdminUsers = vi.fn().mockResolvedValue({ items: [admin] });
    const issueCsrfToken = vi
      .fn()
      .mockResolvedValue({ csrfToken: "a".repeat(43) });
    const createUser = vi.fn().mockResolvedValue({
      ...member,
      id: 2,
      loginName: "bob",
      name: "Bob",
    });
    const client = {
      listAdminUsers,
      issueCsrfToken,
      createUser,
    } as unknown as InpulseApiClient;
    mount(client);

    fireEvent.click(await screen.findByRole("button", { name: "新增用户" }));
    fireEvent.change(screen.getByLabelText("登录名"), {
      target: { value: "bob" },
    });
    fireEvent.change(screen.getByLabelText("姓名"), {
      target: { value: "Bob" },
    });
    fireEvent.change(screen.getByLabelText("邮箱"), {
      target: { value: "bob@example.com" },
    });
    fireEvent.change(screen.getByLabelText("初始密码"), {
      target: { value: "initial-password" },
    });
    fireEvent.click(screen.getByRole("switch", { name: "管理员角色" }));
    fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));

    await waitFor(() => expect(createUser).toHaveBeenCalledTimes(1));
    expect(createUser).toHaveBeenCalledWith(
      {
        loginName: "bob",
        name: "Bob",
        email: "bob@example.com",
        password: ADMIN_USER_INITIAL_PASSWORD,
        isAdmin: true,
      },
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-csrf-token": "a".repeat(43),
          "Idempotency-Key": expect.stringContaining("admin-user-"),
        }),
      }),
    );
    await screen.findByText("用户创建成功");
  });

  it("edits a user and sends row version via If-Match", async () => {
    const listAdminUsers = vi
      .fn()
      .mockResolvedValue({ items: [admin, member] });
    const issueCsrfToken = vi
      .fn()
      .mockResolvedValue({ csrfToken: "a".repeat(43) });
    const updateUser = vi
      .fn()
      .mockResolvedValue({ ...member, name: "Bob Updated", rowVersion: 2 });
    const client = {
      listAdminUsers,
      issueCsrfToken,
      updateUser,
    } as unknown as InpulseApiClient;
    mount(client);
    await screen.findByText("Bob");
    fireEvent.click(
      within(userCard("Bob")).getByRole("button", { name: /编\s*辑/ }),
    );
    fireEvent.change(screen.getByLabelText("姓名"), {
      target: { value: "Bob Updated" },
    });
    fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));
    await waitFor(() => expect(updateUser).toHaveBeenCalledTimes(1));
    expect(updateUser).toHaveBeenCalledWith(
      2,
      { name: "Bob Updated" },
      expect.objectContaining({
        headers: expect.objectContaining({ "If-Match": '"1"' }),
      }),
    );
  });

  it("disables a target user and keeps self actions protected", async () => {
    const listAdminUsers = vi
      .fn()
      .mockResolvedValue({ items: [admin, member] });
    const issueCsrfToken = vi
      .fn()
      .mockResolvedValue({ csrfToken: "a".repeat(43) });
    const disableUser = vi.fn().mockResolvedValue(undefined);
    const client = {
      listAdminUsers,
      issueCsrfToken,
      disableUser,
    } as unknown as InpulseApiClient;
    mount(client);
    await screen.findByText("Bob");
    fireEvent.click(
      within(userCard("Bob")).getByRole("button", { name: /停\s*用/ }),
    );
    const confirm = screen.getByRole("dialog", { name: /停\s*用\s*用\s*户/ });
    fireEvent.click(within(confirm).getByRole("button", { name: /确\s*认/ }));
    await waitFor(() => expect(disableUser).toHaveBeenCalledTimes(1));
    expect(disableUser).toHaveBeenCalledWith(
      2,
      expect.objectContaining({
        headers: expect.objectContaining({
          "If-Match": '"1"',
          "Idempotency-Key": expect.stringContaining("admin-user-"),
        }),
      }),
    );
    await screen.findByText("用户已停用");
  });

  it("opens reauthentication on 403 and reuses the idempotency key after success", async () => {
    const listAdminUsers = vi
      .fn()
      .mockResolvedValue({ items: [admin, member] });
    const issueCsrfToken = vi
      .fn()
      .mockResolvedValue({ csrfToken: "a".repeat(43) });
    const updateUser = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiError(403, {
          code: "ADMIN_REAUTH_REQUIRED",
          message: "needs reauth",
          details: {},
          requestId: "reauth",
        }),
      )
      .mockResolvedValue({ ...member, name: "Bob Updated", rowVersion: 2 });
    const reauthenticateAdmin = vi.fn().mockResolvedValue(undefined);
    const client = {
      listAdminUsers,
      issueCsrfToken,
      updateUser,
    } as unknown as InpulseApiClient;
    mount(client, 1, { reauthenticateAdmin });

    await screen.findByText("Bob");
    fireEvent.click(
      within(userCard("Bob")).getByRole("button", { name: /编\s*辑/ }),
    );
    fireEvent.change(screen.getByLabelText("姓名"), {
      target: { value: "Bob Updated" },
    });
    fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));
    await waitFor(() => expect(updateUser).toHaveBeenCalledTimes(1));
    const dialogs = await screen.findAllByRole("dialog");
    const reauth = dialogs.find((dialog) =>
      dialog.textContent?.includes("验证身份"),
    );
    if (!reauth) throw new Error("reauthentication dialog not found");
    fireEvent.change(within(reauth).getByLabelText("管理员密码"), {
      target: { value: "password" },
    });
    fireEvent.change(within(reauth).getByLabelText("6 位验证码"), {
      target: { value: "123456" },
    });
    fireEvent.click(within(reauth).getByRole("button", { name: "验证身份" }));
    await screen.findByText(/管理员安全验证已完成/);
    fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));
    await waitFor(() => expect(updateUser).toHaveBeenCalledTimes(2));
    const firstKey = (
      updateUser.mock.calls[0]![2] as {
        readonly headers: { readonly "Idempotency-Key": string };
      }
    ).headers["Idempotency-Key"];
    const secondKey = (
      updateUser.mock.calls[1]![2] as {
        readonly headers: { readonly "Idempotency-Key": string };
      }
    ).headers["Idempotency-Key"];
    expect(secondKey).toBe(firstKey);
  });
});
