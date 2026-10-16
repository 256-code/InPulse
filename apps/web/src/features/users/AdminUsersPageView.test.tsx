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

function mount(client: InpulseApiClient, currentUserId = 1) {
  return render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <AuthStateProvider>
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

  it("pins the current account to the top of the list", async () => {
    const listAdminUsers = vi
      .fn()
      .mockResolvedValue({ items: [member, admin] });
    mount({ listAdminUsers } as unknown as InpulseApiClient, admin.id);
    await screen.findByText("Alice");
    const selfCard = userCard("Alice");
    const otherCard = userCard("Bob");
    expect(
      selfCard.compareDocumentPosition(otherCard) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("orders self, then other admins, then members", async () => {
    const otherAdmin: AdminUserItem = {
      ...admin,
      id: 3,
      loginName: "carol",
      name: "Carol",
      email: "carol@example.com",
    };
    const listAdminUsers = vi
      .fn()
      .mockResolvedValue({ items: [member, otherAdmin, admin] });
    mount({ listAdminUsers } as unknown as InpulseApiClient, admin.id);
    await screen.findByText("Alice");
    const rendered = [...document.querySelectorAll(".member-row")].map(
      (row) => row.querySelector("strong")?.textContent ?? "",
    );
    expect(rendered).toEqual(["Alice（当前账号）", "Carol", "Bob"]);
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

  it("reuses the idempotency key when retrying a rejected update", async () => {
    const listAdminUsers = vi
      .fn()
      .mockResolvedValue({ items: [admin, member] });
    const issueCsrfToken = vi
      .fn()
      .mockResolvedValue({ csrfToken: "a".repeat(43) });
    const updateUser = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiError(500, {
          code: "INTERNAL_ERROR",
          message: "internal-detail",
          details: {},
          requestId: "boom",
        }),
      )
      .mockResolvedValue({ ...member, name: "Bob Updated", rowVersion: 2 });
    const client = {
      listAdminUsers,
      issueCsrfToken,
      updateUser,
    } as unknown as InpulseApiClient;
    mount(client, 1);

    await screen.findByText("Bob");
    fireEvent.click(
      within(userCard("Bob")).getByRole("button", { name: /编\s*辑/ }),
    );
    fireEvent.change(screen.getByLabelText("姓名"), {
      target: { value: "Bob Updated" },
    });
    fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));
    await screen.findByText("用户管理服务暂时不可用，请重试。");
    fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));
    await waitFor(() => expect(updateUser).toHaveBeenCalledTimes(2));
    await screen.findByText("用户资料已更新");
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

describe("F-03 settings sections", () => {
  it("switches between the member, permission matrix and notification panels", async () => {
    const client = {
      listAdminUsers: vi.fn().mockResolvedValue({ items: [admin, member] }),
    } as unknown as InpulseApiClient;
    mount(client);
    await screen.findByText("Alice");

    const rail = screen.getByRole("navigation", { name: "成员与设置导航" });
    const memberTab = within(rail).getByRole("button", { name: "成员与角色" });
    const matrixTab = within(rail).getByRole("button", { name: "权限矩阵" });
    const notifyTab = within(rail).getByRole("button", { name: "通知策略" });
    expect(memberTab).toHaveAttribute("aria-current", "page");

    fireEvent.click(matrixTab);
    expect(matrixTab).toHaveAttribute("aria-current", "page");
    expect(memberTab).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("table", { name: "权限矩阵" })).toBeInTheDocument();
    expect(screen.queryByText("Alice")).not.toBeInTheDocument();

    fireEvent.click(notifyTab);
    expect(notifyTab).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("table", { name: "通知场景" })).toBeInTheDocument();
    expect(
      screen.queryByRole("table", { name: "权限矩阵" }),
    ).not.toBeInTheDocument();

    fireEvent.click(memberTab);
    await screen.findByText("Alice");
    expect(memberTab).toHaveAttribute("aria-current", "page");
    expect(
      screen.queryByRole("table", { name: "通知场景" }),
    ).not.toBeInTheDocument();
  });

  it("filters members by name, login name or email and clears back to the full list", async () => {
    const wu: AdminUserItem = {
      ...admin,
      id: 4,
      loginName: "wmj",
      name: "吴孟杰",
      email: "wumengjie@example.com",
      isAdmin: false,
      rowVersion: 1,
    };
    const listAdminUsers = vi
      .fn()
      .mockResolvedValue({ items: [admin, member, wu] });
    mount({ listAdminUsers } as unknown as InpulseApiClient);
    await screen.findByText("Alice");

    const search = screen.getByRole("textbox", { name: "搜索成员" });
    fireEvent.change(search, { target: { value: "孟杰" } });
    expect(screen.getByText("吴孟杰")).toBeInTheDocument();
    expect(screen.queryByText("Alice")).not.toBeInTheDocument();
    expect(screen.queryByText("Bob")).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "wmj" } });
    expect(screen.getByText("吴孟杰")).toBeInTheDocument();
    expect(screen.queryByText("Bob")).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "ALICE@EXAMPLE.COM" } });
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.queryByText("吴孟杰")).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "不存在" } });
    expect(screen.getByText("没有匹配的成员")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清空搜索" }));
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("吴孟杰")).toBeInTheDocument();
  });

  it("管理员可打开 AI 辅助转换页签并加载配置", async () => {
    const listAdminUsers = vi
      .fn()
      .mockResolvedValue({ items: [admin, member] });
    const getAiAssistSettings = vi.fn().mockResolvedValue({
      enabled: false,
      source: "NONE",
      ready: false,
      disabledReason: "NOT_ENABLED",
      endpoint: null,
      model: null,
      timeoutMs: 60_000,
      maxTokens: 8192,
      keyConfigured: false,
      keyHint: null,
      rowVersion: null,
      updatedAt: null,
    });
    mount(
      { listAdminUsers, getAiAssistSettings } as unknown as InpulseApiClient,
      admin.id,
    );
    await screen.findByText("Alice");
    const rail = screen.getByRole("navigation", { name: "成员与设置导航" });
    fireEvent.click(within(rail).getByRole("button", { name: "AI 辅助转换" }));
    expect(await screen.findByText("当前状态")).toBeInTheDocument();
    expect(screen.getByText("当前未启用")).toBeInTheDocument();
    expect(getAiAssistSettings).toHaveBeenCalledTimes(1);
  });

  it("普通成员看不到 AI 辅助转换页签", async () => {
    const listAdminUsers = vi
      .fn()
      .mockResolvedValue({ items: [admin, member] });
    mount({ listAdminUsers } as unknown as InpulseApiClient, member.id);
    await screen.findByText("Bob");
    const rail = screen.getByRole("navigation", { name: "成员与设置导航" });
    expect(
      within(rail).queryByRole("button", { name: "AI 辅助转换" }),
    ).not.toBeInTheDocument();
  });
});
