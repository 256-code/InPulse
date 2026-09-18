import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { InpulseApiClient } from "@generated/api";
import {
  AuthStateProvider,
  type AuthContextValue,
} from "@features/auth/auth-context";
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

  function renderLayout(
    ui: React.ReactElement,
    isAdmin = false,
    authValue: Partial<AuthContextValue> = {},
  ) {
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
            ...authValue,
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
    // 首页与任务中心内容重复，已删除，侧栏不应再出现「首页」入口。
    expect(screen.queryByText("首页")).not.toBeInTheDocument();
    expect(screen.getByText("任务中心")).toBeInTheDocument();
    expect(screen.getByText("项目列表")).toBeInTheDocument();
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
    expect(screen.getByText("审计日志")).toBeInTheDocument();
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
    expect(screen.queryByText("审计日志")).not.toBeInTheDocument();
  });

  it("shows the permission matrix shortcut only to system administrators", async () => {
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
    expect(
      screen.getByRole("button", { name: "查看权限矩阵" }),
    ).toBeInTheDocument();
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
    expect(
      screen.queryByRole("button", { name: "查看权限矩阵" }),
    ).not.toBeInTheDocument();
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
          stats: {
            activeModuleCount: 2,
            activeFeatureCount: 5,
            openTaskCount: 3,
            completedTaskCount: 1,
          },
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
      within(crumb).getByRole("button", { name: "项目列表" }),
    ).toBeInTheDocument();
    expect(projectClient.getProject).toHaveBeenCalledWith(7);
  });

  it("renders the current project group and the task board entry on project routes", async () => {
    const projectClient = {
      listProjects: vi.fn().mockResolvedValue({
        items: [
          {
            id: 7,
            code: "AGV",
            name: "AGV 智能搬运平台",
            status: "ACTIVE",
          },
        ],
      }),
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
          stats: {
            activeModuleCount: 2,
            activeFeatureCount: 5,
            openTaskCount: 3,
            completedTaskCount: 1,
          },
        },
      }),
    } as unknown as InpulseApiClient;

    renderLayout(
      <MemoryRouter initialEntries={["/projects/7/task-board"]}>
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
              path="projects/:projectId/task-board"
              element={<div>任务看板内容</div>}
            />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    const nav = screen.getByRole("navigation", { name: "工作区导航" });
    expect(within(nav).getByText("当前项目")).toBeInTheDocument();
    // 项目子页收进目录树：任务看板是项目节点下的子页行。
    const board = await within(nav).findByRole("button", {
      name: "任务看板",
    });
    expect(board).toHaveClass("page-node");
    expect(board).toHaveAttribute("aria-current", "true");
    // 项目概览已与「模块与功能」合并：项目节点下不再有概览子页行。
    expect(within(nav).queryByRole("button", { name: "项目概览" })).toBeNull();
    expect(
      within(nav).getByRole("button", { name: "模块与功能" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("任务看板内容")).toBeInTheDocument();

    const crumb = screen.getByRole("navigation", { name: "面包屑导航" });
    expect(
      await within(crumb).findByText("AGV 智能搬运平台"),
    ).toBeInTheDocument();
    expect(
      within(crumb).getByRole("button", { name: "项目列表" }),
    ).toBeInTheDocument();
    expect(await within(crumb).findByText("任务看板")).toBeInTheDocument();
  });

  it("expands the project list on the projects page and hides it outside project routes", async () => {
    const projectClient = {
      listProjects: vi.fn().mockResolvedValue({
        items: [
          { id: 7, code: "AGV", name: "AGV 智能搬运平台", status: "ACTIVE" },
          { id: 8, code: "K1235", name: "项目1", status: "ACTIVE" },
        ],
      }),
    } as unknown as InpulseApiClient;

    const { unmount } = renderLayout(
      <MemoryRouter initialEntries={["/projects"]}>
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
            <Route path="projects" element={<div>项目列表内容</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    // 项目列表页直接展开项目树，不必先进某个项目才能切换。
    const nav = screen.getByRole("navigation", { name: "工作区导航" });
    expect(within(nav).getByText("项目")).toBeInTheDocument();
    expect(
      await within(nav).findByRole("button", { name: /AGV 智能搬运平台/ }),
    ).toBeInTheDocument();
    unmount();

    // 项目路由之外（如任务中心）不渲染项目树。
    renderLayout(
      <MemoryRouter initialEntries={["/tasks"]}>
        <Routes>
          <Route
            path="/"
            element={<AppLayout notificationClient={notificationClient} />}
          >
            <Route path="tasks" element={<div>任务中心内容</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByText("当前项目")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "任务看板" })).toBeNull();
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

    await user.click(screen.getByText("项目列表"));
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

  it("renders sidebar counters from the read-only aggregate ports", async () => {
    const counterClient = {
      ...notificationClient,
      listMyTasks: vi.fn().mockResolvedValue({
        items: [],
        nextCursor: null,
        hasMore: false,
        stats: { myOpen: 7, dueToday: 0, overdue: 0, completedThisMonth: 0 },
      }),
      listLeftoverItems: vi.fn().mockResolvedValue({
        items: [{ id: 1 }, { id: 2 }, { id: 3 }],
        nextCursor: null,
        hasMore: false,
      }),
    } as unknown as InpulseApiClient;

    renderLayout(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route
            path="/"
            element={<AppLayout projectClient={counterClient} />}
          />
        </Routes>
      </MemoryRouter>,
    );

    // 计数用 aria-hidden 的 <em> 渲染，不参与导航按钮的可访问名。
    const tasks = await screen.findByRole("button", { name: "任务中心" });
    expect(await within(tasks).findByTitle("7 项待处理")).toHaveTextContent(
      "7",
    );
    const issues = screen.getByRole("button", { name: "遗留问题" });
    expect(within(issues).getByTitle("3 项待处理")).toHaveTextContent("3");
  });

  it("renders the system directory tree inside the projects navigation item", async () => {
    const catalogClient = {
      ...notificationClient,
      listProjects: vi.fn().mockResolvedValue({
        items: [
          {
            id: 7,
            code: "AGV",
            name: "AGV 智能搬运平台",
            status: "ACTIVE",
          },
        ],
      }),
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
          stats: {
            activeModuleCount: 1,
            activeFeatureCount: 1,
            openTaskCount: 1,
            completedTaskCount: 1,
          },
        },
      }),
      listModules: vi
        .fn()
        .mockResolvedValue({ items: [{ id: 3, name: "调度模块" }] }),
      listFeatures: vi
        .fn()
        .mockResolvedValue({ items: [{ id: 5, name: "车辆调度" }] }),
    } as unknown as InpulseApiClient;

    renderLayout(
      <MemoryRouter initialEntries={["/projects/7/modules"]}>
        <Routes>
          <Route
            path="/"
            element={
              <AppLayout
                notificationClient={notificationClient}
                projectClient={catalogClient}
              />
            }
          >
            <Route
              path="projects/:projectId/modules"
              element={<div>项目主页内容</div>}
            />
            <Route
              path="projects/:projectId/modules/:moduleId/features"
              element={<div>功能目录内容</div>}
            />
            <Route
              path="projects/:projectId/modules/:moduleId/features/:featureId"
              element={<div>功能档案内容</div>}
            />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    // 系统目录嵌在「项目与功能」导航项下，不再单独成块；项目路由自动展开。
    const nav = screen.getByRole("navigation", { name: "工作区导航" });
    expect(within(nav).getByText("任务中心")).toBeInTheDocument();
    expect(within(nav).queryByText("系统目录", { selector: "p" })).toBeNull();
    expect(
      await within(nav).findByRole("button", { name: /AGV 智能搬运平台/ }),
    ).toBeInTheDocument();
    expect(
      await within(nav).findByRole("button", { name: /调度模块/ }),
    ).toBeInTheDocument();
    // 目录只是导航，项目主页本身仍然完整渲染。
    expect(screen.getByText("项目主页内容")).toBeInTheDocument();

    await userEvent.click(
      await screen.findByRole("button", { name: /调度模块/ }),
    );
    expect(await screen.findByText("功能目录内容")).toBeInTheDocument();
    await userEvent.click(
      await screen.findByRole("button", { name: /车辆调度/ }),
    );
    expect(await screen.findByText("功能档案内容")).toBeInTheDocument();
  });

  it("opens the feature catalog from the breadcrumb module crumb", async () => {
    const catalogClient = {
      ...notificationClient,
      listProjects: vi.fn().mockResolvedValue({
        items: [
          {
            id: 7,
            code: "AGV",
            name: "AGV 智能搬运平台",
            status: "ACTIVE",
          },
        ],
      }),
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
          stats: {
            activeModuleCount: 1,
            activeFeatureCount: 1,
            openTaskCount: 1,
            completedTaskCount: 1,
          },
        },
      }),
      listModules: vi
        .fn()
        .mockResolvedValue({ items: [{ id: 3, name: "调度模块" }] }),
      listFeatures: vi
        .fn()
        .mockResolvedValue({ items: [{ id: 5, name: "车辆调度" }] }),
    } as unknown as InpulseApiClient;

    renderLayout(
      <MemoryRouter initialEntries={["/projects/7/modules/3/features/5"]}>
        <Routes>
          <Route
            path="/"
            element={
              <AppLayout
                notificationClient={notificationClient}
                projectClient={catalogClient}
              />
            }
          >
            <Route
              path="projects/:projectId/modules/:moduleId/features"
              element={<div>功能目录内容</div>}
            />
            <Route
              path="projects/:projectId/modules/:moduleId/features/:featureId"
              element={<div>功能档案内容</div>}
            />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    const crumb = screen.getByRole("navigation", { name: "面包屑导航" });
    // 面包屑的模块名必须落到已注册的功能目录路由，而不是未注册的模块路径。
    await userEvent.click(
      await within(crumb).findByRole("button", { name: "调度模块" }),
    );
    expect(await screen.findByText("功能目录内容")).toBeInTheDocument();
  });

  it("returns to the project modules page from the breadcrumb project crumb", async () => {
    const crumbClient = {
      ...notificationClient,
      listProjects: vi.fn().mockResolvedValue({
        items: [
          {
            id: 7,
            code: "AGV",
            name: "AGV 智能搬运平台",
            status: "ACTIVE",
          },
        ],
      }),
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
          stats: {
            activeModuleCount: 1,
            activeFeatureCount: 1,
            openTaskCount: 1,
            completedTaskCount: 1,
          },
        },
      }),
      listModules: vi
        .fn()
        .mockResolvedValue({ items: [{ id: 3, name: "调度模块" }] }),
      listFeatures: vi
        .fn()
        .mockResolvedValue({ items: [{ id: 5, name: "车辆调度" }] }),
    } as unknown as InpulseApiClient;

    renderLayout(
      <MemoryRouter initialEntries={["/projects/7/modules/3/features/5"]}>
        <Routes>
          <Route
            path="/"
            element={
              <AppLayout
                notificationClient={notificationClient}
                projectClient={crumbClient}
              />
            }
          >
            <Route
              path="projects/:projectId/modules"
              element={<div>模块列表内容</div>}
            />
            <Route
              path="projects/:projectId/modules/:moduleId/features/:featureId"
              element={<div>功能档案内容</div>}
            />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    const crumb = screen.getByRole("navigation", { name: "面包屑导航" });
    // 项目名必须落到项目主页（模块列表页）：概览页把模块与功能藏在「查看模块」
    // 入口后，不满足「从模块返回项目时功能不收起」。
    await userEvent.click(
      await within(crumb).findByRole("button", { name: "AGV 智能搬运平台" }),
    );
    expect(await screen.findByText("模块列表内容")).toBeInTheDocument();
  });

  it("hides the project tree outside project pages", async () => {
    renderLayout(
      <MemoryRouter initialEntries={["/tasks"]}>
        <Routes>
          <Route
            path="/"
            element={<AppLayout notificationClient={notificationClient} />}
          >
            <Route path="tasks" element={<div>任务中心内容</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("任务中心内容")).toBeInTheDocument();
    // 目录树只存在于「当前项目」分组：非项目路由不渲染项目上下文。
    expect(document.querySelector(".project-tree")).toBeNull();
    expect(screen.queryByText("当前项目")).not.toBeInTheDocument();
  });
  describe("退出登录", () => {
    const originalLocation = window.location;

    beforeEach(() => {
      Object.defineProperty(window, "location", {
        configurable: true,
        writable: true,
        value: {
          href: originalLocation.href,
          origin: originalLocation.origin,
          pathname: originalLocation.pathname,
          search: originalLocation.search,
          assign: vi.fn(),
          replace: vi.fn(),
        },
      });
    });

    afterEach(() => {
      Object.defineProperty(window, "location", {
        configurable: true,
        writable: true,
        value: originalLocation,
      });
    });

    it("退出登录后整页跳转统一身份认证入口，不再经由登录页中转", async () => {
      const user = userEvent.setup();
      const logout = vi.fn().mockResolvedValue(undefined);
      renderLayout(
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route
              path="/"
              element={<AppLayout notificationClient={notificationClient} />}
            />
          </Routes>
        </MemoryRouter>,
        false,
        { logout },
      );

      await user.click(screen.getByRole("button", { name: "账户菜单" }));
      await user.click(screen.getByRole("button", { name: /退出登录/ }));

      await waitFor(() => {
        expect(logout).toHaveBeenCalledTimes(1);
        expect(window.location.replace).toHaveBeenCalledWith(
          "/api/v1/auth/sso/start?returnTo=%2F",
        );
      });
    });

    it("未登录时点击前往登录同样直接进入统一身份认证入口", async () => {
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
        false,
        { status: "anonymous", user: null },
      );

      await user.click(screen.getByRole("button", { name: "账户菜单" }));
      await user.click(screen.getByRole("button", { name: /前往登录/ }));

      expect(window.location.replace).toHaveBeenCalledWith(
        "/api/v1/auth/sso/start?returnTo=%2F",
      );
    });
  });
});
