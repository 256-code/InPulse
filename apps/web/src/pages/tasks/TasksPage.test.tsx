import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { InpulseApiClient } from "@generated/api";
import { AuthStateProvider } from "@features/auth/auth-context";
import {
  MY_TASKS_FULL_FILTER_SUPPORT,
  type MyTaskGroupsResult,
  type MyTaskListItem,
  type MyTaskListResult,
  type MyTasksAdapter,
  type MyTasksQueryInput,
} from "@features/my-tasks/my-tasks-types";
import { TasksPage } from "./TasksPage";

const LocationProbe: React.FC = () => {
  const location = useLocation();
  return <div data-testid="location-search">{location.search}</div>;
};

const ArchiveProbe: React.FC = () => {
  const location = useLocation();
  return (
    <div data-testid="archive-probe">{location.pathname + location.search}</div>
  );
};

const emptyResult: MyTaskListResult = {
  items: [],
  nextCursor: null,
  hasMore: false,
  stats: { myOpen: 0, dueToday: 0, overdue: 0, completedThisMonth: 0 },
  scopeCounts: { mine: 0, created: 0, project: 0, all: 0 },
  leftoverCount: 0,
  leftoverSample: null,
  filterSupport: MY_TASKS_FULL_FILTER_SUPPORT,
};

const featureTask: MyTaskListItem = {
  taskId: 320,
  code: "INP-320",
  title: "功能级任务",
  projectId: 7,
  projectName: "注入项目名",
  moduleId: 71,
  moduleName: "未分类",
  featureId: 711,
  featureName: "登录功能",
  scopeType: "FEATURE",
  workStatus: "TODO",
  lifecycleStatus: "ACTIVE",
  priority: "NORMAL",
  dueAt: null,
  updatedAt: "2026-09-12T00:00:00.000Z",
  completedAt: null,
  creatorId: 1,
  assignee: { userId: 1, name: "开发者 C", avatarUrl: null },
  hasPublishedRecord: false,
  publishedRecordCount: 0,
  groupRole: null,
  githubLinkCount: 0,
  groupId: null,
};

const moduleTask: MyTaskListItem = {
  ...featureTask,
  taskId: 321,
  code: "INP-321",
  title: "模块级任务",
  moduleId: 72,
  featureId: null,
  featureName: null,
  scopeType: "MODULE",
};

const createAdapter = (items: MyTaskListItem[] = []) => {
  const fetchMyTasks = vi.fn(
    async (_input: MyTasksQueryInput): Promise<MyTaskListResult> => ({
      ...emptyResult,
      items,
    }),
  );
  const fetchTaskGroups = vi.fn(async (): Promise<MyTaskGroupsResult> => ({
    items: [],
    nextCursor: null,
    hasMore: false,
  }));
  const adapter: MyTasksAdapter = {
    source: "mock",
    notice: "测试骨架数据",
    fetchMyTasks,
    fetchTaskGroups,
  };
  return { adapter, fetchMyTasks, fetchTaskGroups };
};

interface RenderOptions {
  readonly entries?: string;
  readonly isAdmin?: boolean;
  readonly items?: MyTaskListItem[];
}

const renderPage = (options: RenderOptions = {}) => {
  const { adapter, fetchMyTasks } = createAdapter(options.items ?? []);
  const listProjects = vi.fn().mockResolvedValue({ items: [] });
  const client = { listProjects } as unknown as InpulseApiClient;
  render(
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
            isAdmin: options.isAdmin === true,
            status: "ACTIVE",
          },
        }}
      >
        <MemoryRouter initialEntries={[options.entries ?? "/tasks"]}>
          <Routes>
            <Route
              path="/tasks"
              element={
                <>
                  <TasksPage client={client} adapter={adapter} />
                  <LocationProbe />
                </>
              }
            />
            <Route path="/issues" element={<div>遗留问题页</div>} />
            <Route
              path="/projects/:projectId/modules/:moduleId/features/:featureId?"
              element={<ArchiveProbe />}
            />
            <Route
              path="/projects/:projectId/modules/:moduleId/tasks"
              element={<ArchiveProbe />}
            />
          </Routes>
        </MemoryRouter>
      </AuthStateProvider>
    </QueryClientProvider>,
  );
  return { fetchMyTasks, listProjects };
};

describe("TasksPage", () => {
  it("reads the filter state from the URL", async () => {
    const { fetchMyTasks } = renderPage({
      entries: "/tasks?scope=created&status=done&q=登录&view=list",
    });
    await waitFor(() =>
      expect(fetchMyTasks).toHaveBeenCalledWith({
        filters: expect.objectContaining({
          scope: "created",
          status: "done",
          query: "登录",
          display: "list",
        }),
        viewerId: 1,
        cursor: null,
      }),
    );
  });

  it("writes filter changes back to the URL", async () => {
    const { fetchMyTasks } = renderPage();
    const user = userEvent.setup();
    await waitFor(() => expect(fetchMyTasks).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("tab", { name: /我创建的/ }));
    await waitFor(() =>
      expect(screen.getByTestId("location-search")).toHaveTextContent(
        "scope=created",
      ),
    );
    await waitFor(() =>
      expect(fetchMyTasks).toHaveBeenLastCalledWith({
        filters: expect.objectContaining({ scope: "created" }),
        viewerId: 1,
        cursor: null,
      }),
    );
  });

  it("toggles the advanced panel through the more parameter", async () => {
    renderPage({ entries: "/tasks?more=1" });
    const user = userEvent.setup();
    expect(await screen.findByLabelText("合并关系")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /更多筛选/ }));
    await waitFor(() => expect(screen.queryByLabelText("合并关系")).toBeNull());
    expect(screen.getByTestId("location-search")).not.toHaveTextContent(
      "more=1",
    );
  });

  it("navigates to the leftover issues page", async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /遗留问题/ }));
    expect(await screen.findByText("遗留问题页")).toBeInTheDocument();
  });

  it("navigates a feature task card straight into the feature archive", async () => {
    renderPage({ items: [featureTask, moduleTask] });
    const user = userEvent.setup();

    // 任务中心不弹只读详情：点击卡片直接定位到功能档案，由 ?taskId= 打开任务抽屉。
    await user.click(await screen.findByTestId("my-task-320"));
    expect(await screen.findByTestId("archive-probe")).toHaveTextContent(
      "/projects/7/modules/71/features/711?taskId=320",
    );
  });

  it("navigates a module-level task row into the module task archive", async () => {
    renderPage({ entries: "/tasks?view=list", items: [moduleTask] });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /模块级任务/ }));

    expect(await screen.findByTestId("archive-probe")).toHaveTextContent(
      "/projects/7/modules/72/tasks?taskId=321",
    );
  });

  it("demotes the admin-only scope for non-admins", async () => {
    const { fetchMyTasks } = renderPage({ entries: "/tasks?scope=all" });
    await waitFor(() =>
      expect(fetchMyTasks).toHaveBeenCalledWith({
        filters: expect.objectContaining({ scope: "mine" }),
        viewerId: 1,
        cursor: null,
      }),
    );
    expect(screen.queryByRole("tab", { name: /全部任务/ })).toBeNull();
  });

  it("keeps the admin scope for admins", async () => {
    const { fetchMyTasks } = renderPage({
      entries: "/tasks?scope=all",
      isAdmin: true,
    });
    await waitFor(() =>
      expect(fetchMyTasks).toHaveBeenCalledWith({
        filters: expect.objectContaining({ scope: "all" }),
        viewerId: 1,
        cursor: null,
      }),
    );
    expect(
      await screen.findByRole("tab", { name: /全部任务/ }),
    ).toHaveAttribute("aria-selected", "true");
  });
});
