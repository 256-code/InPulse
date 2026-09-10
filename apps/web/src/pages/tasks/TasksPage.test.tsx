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
  type MyTaskListResult,
  type MyTasksAdapter,
  type MyTasksQueryInput,
} from "@features/my-tasks/my-tasks-types";
import { TasksPage } from "./TasksPage";

const LocationProbe: React.FC = () => {
  const location = useLocation();
  return <div data-testid="location-search">{location.search}</div>;
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

const createAdapter = () => {
  const fetchMyTasks = vi.fn(
    async (_input: MyTasksQueryInput): Promise<MyTaskListResult> => emptyResult,
  );
  const adapter: MyTasksAdapter = {
    source: "mock",
    notice: "测试骨架数据",
    fetchMyTasks,
  };
  return { adapter, fetchMyTasks };
};

interface RenderOptions {
  readonly entries?: string;
  readonly isAdmin?: boolean;
}

const renderPage = (options: RenderOptions = {}) => {
  const { adapter, fetchMyTasks } = createAdapter();
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

  it("demotes the admin-only scope for non-admins", async () => {
    const { fetchMyTasks } = renderPage({ entries: "/tasks?scope=all" });
    await waitFor(() =>
      expect(fetchMyTasks).toHaveBeenCalledWith({
        filters: expect.objectContaining({ scope: "mine" }),
        viewerId: 1,
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
      }),
    );
    expect(
      await screen.findByRole("tab", { name: /全部任务/ }),
    ).toHaveAttribute("aria-selected", "true");
  });
});
