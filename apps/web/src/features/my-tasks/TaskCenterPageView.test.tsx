import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ProjectItem } from "@generated/api";
import { TaskCenterPageView } from "./TaskCenterPageView";
import { DEFAULT_MY_TASK_FILTERS } from "./my-tasks-url";
import type { MyTasksAdapter } from "./my-tasks-types";

const projects: readonly ProjectItem[] = [
  {
    id: 1,
    code: "INP",
    name: "注入项目名",
    description: "项目说明",
    status: "ACTIVE",
    rowVersion: 1,
    createdBy: 1,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    memberCount: 3,
  },
  {
    id: 5,
    code: "ORD",
    name: "订单中台",
    description: "项目说明",
    status: "ACTIVE",
    rowVersion: 1,
    createdBy: 1,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    memberCount: 2,
  },
];

interface ViewOverrides {
  readonly isAdmin?: boolean;
  readonly advancedOpen?: boolean;
  readonly adapter?: MyTasksAdapter;
  readonly onFiltersChange?: (next: unknown) => void;
  readonly onToggleAdvanced?: () => void;
  readonly onOpenIssues?: () => void;
}

const renderView = (overrides: ViewOverrides = {}) => {
  const onFiltersChange = overrides.onFiltersChange ?? vi.fn();
  const onToggleAdvanced = overrides.onToggleAdvanced ?? vi.fn();
  const onOpenIssues = overrides.onOpenIssues ?? vi.fn();
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false } },
        })
      }
    >
      <TaskCenterPageView
        filters={DEFAULT_MY_TASK_FILTERS}
        onFiltersChange={onFiltersChange}
        viewerId={1}
        isAdmin={overrides.isAdmin === true}
        projects={projects}
        advancedOpen={overrides.advancedOpen === true}
        onToggleAdvanced={onToggleAdvanced}
        onOpenIssues={onOpenIssues}
        {...(overrides.adapter ? { adapter: overrides.adapter } : {})}
      />
    </QueryClientProvider>,
  );
  return { onFiltersChange, onToggleAdvanced, onOpenIssues };
};

describe("TaskCenterPageView", () => {
  it("renders the skeleton notice, stat cards and scope tabs", async () => {
    renderView();

    expect(screen.getByTestId("task-center-mock-notice")).toHaveTextContent(
      "骨架数据",
    );

    const myOpen = await screen.findByTestId("stat-my-open");
    expect(await within(myOpen).findByText("4")).toBeInTheDocument();
    expect(
      await within(screen.getByTestId("stat-due-today")).findByText("1"),
    ).toBeInTheDocument();
    expect(
      await within(screen.getByTestId("stat-overdue")).findByText("1"),
    ).toBeInTheDocument();
    expect(
      await within(screen.getByTestId("stat-completed")).findByText(/^[23]$/),
    ).toBeInTheDocument();

    const mineTab = screen.getByRole("tab", { name: /我负责的/ });
    expect(mineTab).toHaveAttribute("aria-selected", "true");
    expect(mineTab).toHaveTextContent("我负责的8");
    expect(screen.queryByRole("tab", { name: /全部任务/ })).toBeNull();
  });

  it("shows open tasks only by default and hides done and canceled", async () => {
    renderView();

    expect(await screen.findByTestId("my-task-101")).toBeInTheDocument();
    expect(screen.queryByTestId("my-task-104")).toBeNull();
    expect(screen.queryByTestId("my-task-107")).toBeNull();
    expect(screen.queryByText(/已完成 .* 项/)).toBeNull();
  });

  it("resolves project names from the injected project port", async () => {
    renderView();
    const card = await screen.findByTestId("my-task-101");
    expect(card).toHaveTextContent("注入项目名");
  });

  it("offers the admin scope only to admins", async () => {
    renderView({ isAdmin: true });
    expect(
      await screen.findByRole("tab", { name: /全部任务/ }),
    ).toBeInTheDocument();
  });

  it("reports scope changes through onFiltersChange", async () => {
    const { onFiltersChange } = renderView();
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /我创建的/ }));
    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "created" }),
    );
    await user.click(screen.getByRole("tab", { name: /按项目/ }));
    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "project", projectId: 1 }),
    );
  });

  it("reports status, query and advanced toggles", async () => {
    const { onFiltersChange, onToggleAdvanced } = renderView();
    const user = userEvent.setup();

    await user.click(
      within(screen.getByRole("group", { name: "工作状态" })).getByRole(
        "button",
        { name: "已完成" },
      ),
    );
    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({ status: "done" }),
    );

    const search = screen.getByLabelText("搜索任务");
    await user.type(search, "登");
    await waitFor(() =>
      expect(onFiltersChange).toHaveBeenCalledWith(
        expect.objectContaining({ query: "登" }),
      ),
    );

    await user.click(screen.getByRole("button", { name: /更多筛选/ }));
    expect(onToggleAdvanced).toHaveBeenCalledTimes(1);
  });

  it("routes the leftover entry through onOpenIssues", async () => {
    const { onOpenIssues } = renderView();
    const user = userEvent.setup();
    const button = await screen.findByRole("button", { name: /遗留问题 3/ });
    await user.click(button);
    expect(onOpenIssues).toHaveBeenCalledTimes(1);
  });

  it("invokes onOpenIssues from the leftover risk banner", async () => {
    const { onOpenIssues } = renderView();
    const user = userEvent.setup();
    const banner = await screen.findByRole("button", {
      name: /条遗留问题尚未闭环/,
    });
    await user.click(banner);
    expect(onOpenIssues).toHaveBeenCalledTimes(1);
  });

  it("renders an error alert when the adapter rejects", async () => {
    renderView({
      adapter: {
        source: "mock",
        notice: "测试失败路径",
        fetchMyTasks: () => Promise.reject(new Error("boom")),
      },
    });
    expect(
      await screen.findByText("任务列表暂时不可用，请稍后重试。"),
    ).toBeInTheDocument();
  });

  it("marks module scope, merge role and priority on task cards", async () => {
    renderView();

    const merged = await screen.findByTestId("my-task-102");
    expect(within(merged).getByText("模块级")).toBeInTheDocument();
    expect(within(merged).getByText("主任务")).toBeInTheDocument();
    expect(within(merged).getByText("高优先级")).toBeInTheDocument();
    expect(within(merged).getByText("记录 1 条")).toBeInTheDocument();

    const plain = await screen.findByTestId("my-task-101");
    expect(within(plain).getByText("紧急优先级")).toBeInTheDocument();
    expect(within(plain).queryByText(/记录/)).toBeNull();
  });
});
