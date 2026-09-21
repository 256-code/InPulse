import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { TaskBoardCard, TaskBoardResponse } from "@generated/api";
import { AuthStateProvider } from "@features/auth/auth-context";

import { TaskBoardPageView } from "./TaskBoardPageView";
import { DEFAULT_TASK_BOARD_FILTERS } from "./task-board-filters";
import type { TaskBoardAdapter, TaskBoardFilters } from "./task-board-types";

function cardOf(overrides: Partial<TaskBoardCard> = {}): TaskBoardCard {
  return {
    taskId: 1,
    code: "T-1001",
    title: "实现任务看板",
    moduleId: 3,
    featureId: 5,
    featureName: "任务看板",
    scopeType: "FEATURE",
    priority: "NORMAL",
    workStatus: "TODO",
    dueAt: "2026-09-17T18:30:00.000Z",
    completedAt: null,
    dueState: "TODAY",
    assignee: { userId: 9, name: "张启明", avatarUrl: null },
    publishedRecordCount: 0,
    ...overrides,
  };
}

const response: TaskBoardResponse = {
  project: { projectId: 7, name: "支付中心", status: "ACTIVE" },
  generatedAt: "2026-09-17T06:20:00.000Z",
  stats: {
    total: 42,
    done: 27,
    open: 12,
    canceled: 3,
    overdue: 3,
    dueToday: 2,
    completedThisWeek: 5,
    completionRate: 69,
    featureCount: 8,
    memberCount: 4,
  },
  modules: [
    {
      moduleId: 3,
      name: "调度模块",
      featureCount: 2,
      stats: {
        total: 30,
        done: 25,
        open: 4,
        canceled: 1,
        overdue: 1,
        completionRate: 86,
      },
      assignees: [{ userId: 9, name: "张启明", avatarUrl: null }],
      tasks: [
        cardOf(),
        cardOf({
          taskId: 2,
          code: "T-1002",
          title: "补齐看板筛选",
          workStatus: "DONE",
          dueState: "NONE",
          completedAt: "2026-09-17T18:30:00.000Z",
          publishedRecordCount: 2,
        }),
      ],
    },
    {
      moduleId: 4,
      name: "结算模块",
      featureCount: 1,
      stats: {
        total: 12,
        done: 2,
        open: 8,
        canceled: 2,
        overdue: 2,
        completionRate: 20,
      },
      assignees: [],
      tasks: [
        cardOf({
          taskId: 3,
          code: "T-1003",
          title: "结算对账",
          moduleId: 4,
          featureId: null,
          featureName: null,
          scopeType: "MODULE",
          workStatus: "CANCELED",
          dueState: "NONE",
          dueAt: null,
        }),
      ],
    },
  ],
  truncated: false,
};

const emptyResponse: TaskBoardResponse = {
  project: response.project,
  generatedAt: response.generatedAt,
  stats: {
    total: 0,
    done: 0,
    open: 0,
    canceled: 0,
    overdue: 0,
    dueToday: 0,
    completedThisWeek: 0,
    completionRate: 0,
    featureCount: 0,
    memberCount: 0,
  },
  modules: [],
  truncated: false,
};

interface RenderOptions {
  readonly response?: TaskBoardResponse;
  readonly filters?: TaskBoardFilters;
  readonly onFiltersChange?: (next: TaskBoardFilters) => void;
  readonly onOpenModules?: () => void;
}

function renderView(options: RenderOptions = {}) {
  const fetchTaskBoard = vi
    .fn()
    .mockResolvedValue(options.response ?? response);
  const adapter: TaskBoardAdapter = {
    source: "test",
    notice: "测试看板骨架",
    fetchTaskBoard,
  };
  const onFiltersChange = options.onFiltersChange ?? vi.fn();
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
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
            isAdmin: false,
            status: "ACTIVE",
          },
        }}
      >
        <TaskBoardPageView
          projectId={7}
          filters={options.filters ?? DEFAULT_TASK_BOARD_FILTERS}
          onFiltersChange={onFiltersChange}
          adapter={adapter}
          onOpenModules={options.onOpenModules ?? vi.fn()}
        />
      </AuthStateProvider>
    </QueryClientProvider>,
  );
  return { fetchTaskBoard, onFiltersChange };
}

describe("TaskBoardPageView", () => {
  it("按模块泳道渲染看板，顶部统计为项目全量口径", async () => {
    const { fetchTaskBoard } = renderView();

    expect(
      await screen.findByRole("img", { name: "项目完成率 69%" }),
    ).toBeInTheDocument();
    expect(fetchTaskBoard).toHaveBeenCalledWith({ projectId: 7 });
    expect(screen.getByText("已完成 27 / 42")).toBeInTheDocument();
    expect(
      screen.getByText("未完成 12 · 逾期 3 · 今日到期 2"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: /支付中心 · 数据截至 2026-09-17 14:20/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("article", { name: "模块 调度模块" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("article", { name: "模块 结算模块" }),
    ).toBeInTheDocument();
    // 卡片配色与列表行同源：优先级决定底色与左侧色条，已完成 / 已取消覆盖状态色。
    expect(
      screen.getByRole("button", { name: "打开任务 T-1001 实现任务看板" }),
    ).toHaveClass("tb-card", "tone-prio-normal");
    expect(
      screen.getByRole("button", { name: "打开任务 T-1002 补齐看板筛选" }),
    ).toHaveClass("tb-card", "tone-prio-done");
    expect(
      screen.getByRole("button", { name: "打开任务 T-1003 结算对账" }),
    ).toHaveClass("tb-card", "tone-prio-canceled");
    expect(screen.getByText("完成 09-18 · 迭代 2")).toBeInTheDocument();
  });

  it("筛选只影响卡片与泳道，顶部完成率仍为全量口径", async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();
    renderView({
      filters: { ...DEFAULT_TASK_BOARD_FILTERS, status: "done" },
      onFiltersChange,
    });

    expect(
      await screen.findByRole("img", { name: "项目完成率 69%" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/筛选结果 1 \/ 42/)).toBeInTheDocument();
    expect(
      screen.getByRole("article", { name: "模块 调度模块" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: "模块 结算模块" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(onFiltersChange).toHaveBeenCalledWith(DEFAULT_TASK_BOARD_FILTERS);
  });

  it("点列表切换时把视图写回筛选状态", async () => {
    const user = userEvent.setup();
    const { onFiltersChange } = renderView();
    await screen.findByRole("img", { name: "项目完成率 69%" });

    await user.click(screen.getByRole("button", { name: "列表" }));
    expect(onFiltersChange).toHaveBeenCalledWith({
      ...DEFAULT_TASK_BOARD_FILTERS,
      view: "list",
    });
  });

  it("列表视图渲染分组表格行", async () => {
    renderView({ filters: { ...DEFAULT_TASK_BOARD_FILTERS, view: "list" } });

    const row = await screen.findByRole("button", {
      name: "打开任务 T-1003 结算对账",
    });
    expect(within(row).getByText("模块级任务")).toBeInTheDocument();
    expect(within(row).getByText("已取消")).toBeInTheDocument();
    // 行配色：优先级决定底色（tone 类），已取消覆盖状态色。
    expect(row).toHaveClass("tb-row", "tb-row--tone-blue", "tb-row--canceled");

    const doneRow = screen.getByRole("button", {
      name: "打开任务 T-1002 补齐看板筛选",
    });
    expect(doneRow).toHaveClass("tb-row", "tb-row--tone-blue", "tb-row--done");
  });

  it("检索无命中时提示调整筛选并保留清除入口", async () => {
    renderView({
      filters: { ...DEFAULT_TASK_BOARD_FILTERS, query: "不存在的任务" },
    });

    expect(
      await screen.findByText("没有匹配筛选条件的任务"),
    ).toBeInTheDocument();
    const empty = document.querySelector(".tb-empty");
    expect(empty).not.toBeNull();
    expect(
      within(empty as HTMLElement).getByRole("button", { name: "清除筛选" }),
    ).toBeInTheDocument();
  });

  it("空项目引导前往模块与功能创建第一个任务", async () => {
    const user = userEvent.setup();
    const onOpenModules = vi.fn();
    renderView({ response: emptyResponse, onOpenModules });

    expect(await screen.findByText("项目还没有任务")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "前往模块与功能" }));
    expect(onOpenModules).toHaveBeenCalledTimes(1);
  });

  it("截断时提示列表已按排序截断且统计仍为全量口径", async () => {
    renderView({ response: { ...response, truncated: true } });

    expect(await screen.findByRole("status")).toHaveTextContent(
      "任务超过 1000 条",
    );
  });
});
