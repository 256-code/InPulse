import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { InpulseApiClient } from "@generated/api";
import { AuthStateProvider } from "@features/auth/auth-context";
import { AppLayout } from "./AppLayout";

describe("AppLayout", () => {
  const notificationClient = {
    getNotificationUnreadCount: vi.fn().mockResolvedValue({ unreadCount: 1 }),
    getNotifications: vi.fn().mockResolvedValue({
      items: [
        {
          id: "42",
          projectId: 7,
          notificationType: "PROJECT_JOINED",
          title: "你已加入成员项目",
          body: "成员项目通知",
          targetPath: "/projects/7/activity",
          createdAt: "2026-09-08T00:00:00.000Z",
          readAt: null,
        },
      ],
      nextCursor: null,
      hasMore: false,
    }),
    issueCsrfToken: vi.fn().mockResolvedValue({ csrfToken: "csrf-1" }),
    readNotification: vi.fn().mockResolvedValue(undefined),
  } as unknown as InpulseApiClient;

  function renderLayout(ui: React.ReactElement, isAdmin = false) {
    return render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false } },
          })
        }
      >
        <AuthStateProvider
          value={{
            status: "authenticated",
            user: {
              id: 1,
              loginName: "developer",
              name: "开发者 C",
              email: null,
              avatarUrl: null,
              isAdmin,
              status: "ACTIVE",
            },
          }}
        >
          {ui}
        </AuthStateProvider>
      </QueryClientProvider>,
    );
  }

  it("renders the latest workspace navigation and header search trigger", async () => {
    renderLayout(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route
            path="/"
            element={<AppLayout notificationClient={notificationClient} />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("img", { name: "Libiao Robotics | InPulse" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("研发交付中心")).not.toHaveLength(0);
    expect(screen.getByText("任务中心")).toBeInTheDocument();
    expect(screen.getByText("项目与功能")).toBeInTheDocument();
    expect(screen.getByText("迭代记录")).toBeInTheDocument();
    expect(screen.getByText("遗留问题")).toBeInTheDocument();
    expect(screen.getByText("项目动态")).toBeInTheDocument();
    expect(screen.getByText("成员与设置")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "打开全局搜索" }),
    ).toBeInTheDocument();
    await screen.findByRole("button", { name: "通知" });
    expect(notificationClient.getNotificationUnreadCount).toHaveBeenCalled();
  });

  it("shows the audit entry only to system administrators", async () => {
    const { unmount } = renderLayout(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route
            path="/"
            element={<AppLayout notificationClient={notificationClient} />}
          />
        </Routes>
      </MemoryRouter>,
      true,
    );
    expect(screen.getByText("动态审计")).toBeInTheDocument();
    unmount();

    renderLayout(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route
            path="/"
            element={<AppLayout notificationClient={notificationClient} />}
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.queryByText("动态审计")).not.toBeInTheDocument();
  });

  it("shows the project name in the breadcrumb on project routes", async () => {
    const projectClient = {
      getProject: vi.fn().mockResolvedValue({
        project: {
          id: 7,
          code: "AGV",
          name: "AGV 智能搬运平台",
          description: "面向工厂的智能搬运调度项目",
          status: "ACTIVE",
          rowVersion: 1,
          createdBy: 1,
          createdAt: "2026-09-08T00:00:00.000Z",
          updatedAt: "2026-09-08T00:00:00.000Z",
          memberCount: 4,
        },
      }),
    } as unknown as InpulseApiClient;

    renderLayout(
      <MemoryRouter initialEntries={["/projects/7/modules"]}>
        <Routes>
          <Route
            path="/"
            element={
              <AppLayout
                notificationClient={notificationClient}
                projectClient={projectClient}
              />
            }
          >
            <Route
              path="projects/:projectId/modules"
              element={<div>Modules content</div>}
            />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    const crumb = screen.getByRole("navigation", { name: "面包屑导航" });
    expect(
      await within(crumb).findByText("AGV 智能搬运平台"),
    ).toBeInTheDocument();
    expect(
      within(crumb).getByRole("button", { name: "项目与功能" }),
    ).toBeInTheDocument();
    expect(projectClient.getProject).toHaveBeenCalledWith(7);
  });

  it("navigates to a registered workspace route", async () => {
    const user = userEvent.setup();
    renderLayout(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route
            path="/"
            element={<AppLayout notificationClient={notificationClient} />}
          >
            <Route index element={<div>Home content</div>} />
            <Route path="projects" element={<div>Projects content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByText("项目与功能"));
    expect(await screen.findByText("Projects content")).toBeInTheDocument();
  });

  it("opens the global command palette from the header search button", async () => {
    const user = userEvent.setup();
    renderLayout(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route
            path="/"
            element={<AppLayout notificationClient={notificationClient} />}
          >
            <Route index element={<div>Home content</div>} />
            <Route
              path="notifications"
              element={<div>Notifications content</div>}
            />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "打开全局搜索" }));
    expect(
      screen.getByRole("dialog", { name: "全局搜索" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^打开通知中心/ }));
    expect(
      await screen.findByText("Notifications content"),
    ).toBeInTheDocument();
  });

  it("opens the notification popover and can open the full page", async () => {
    const user = userEvent.setup();
    renderLayout(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route
            path="/"
            element={<AppLayout notificationClient={notificationClient} />}
          >
            <Route index element={<div>Home content</div>} />
            <Route
              path="notifications"
              element={<div>Notifications content</div>}
            />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole("button", { name: "通知" }));
    expect(await screen.findByText("你已加入成员项目")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "查看全部通知" }));
    expect(
      await screen.findByText("Notifications content"),
    ).toBeInTheDocument();
  });

  it("opens admin reauthentication from the account menu", async () => {
    const user = userEvent.setup();
    renderLayout(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route
            path="/"
            element={<AppLayout notificationClient={notificationClient} />}
          />
        </Routes>
      </MemoryRouter>,
      true,
    );

    await user.click(await screen.findByRole("button", { name: "账户菜单" }));
    await user.click(screen.getByRole("button", { name: "管理员安全验证" }));
    expect(
      await screen.findByRole("dialog", { name: "管理员安全验证" }),
    ).toBeInTheDocument();
  });
});
