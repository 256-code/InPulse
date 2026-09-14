import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { InpulseApiClient, ProjectItem } from "@generated/api";
import { TaskCenterPageView } from "./TaskCenterPageView";
import { MY_TASKS_MOCK_ADAPTER } from "./my-tasks-mock";
import { MY_TASKS_V1_FILTER_SUPPORT } from "./my-tasks-v1-query";
import { DEFAULT_MY_TASK_FILTERS } from "./my-tasks-url";
import type { MyTaskFilters } from "./my-tasks-types";
import type { MyTaskListItem } from "./my-tasks-types";
import type { MyTasksAdapter } from "./my-tasks-types";
import type { TaskLocation } from "@features/tasks/task-links";

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
    stats: { activeModuleCount: 2, activeFeatureCount: 5, openTaskCount: 4 },
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
    stats: { activeModuleCount: 1, activeFeatureCount: 3, openTaskCount: 2 },
  },
];

interface ViewOverrides {
  readonly isAdmin?: boolean;
  readonly advancedOpen?: boolean;
  readonly adapter?: MyTasksAdapter;
  readonly filters?: Partial<MyTaskFilters>;
  readonly client?: InpulseApiClient;
  readonly onFiltersChange?: (next: unknown) => void;
  readonly onToggleAdvanced?: () => void;
  readonly onOpenIssues?: () => void;
  readonly onOpenTask?: (task: TaskLocation) => void;
}

const renderView = (overrides: ViewOverrides = {}) => {
  const onFiltersChange = overrides.onFiltersChange ?? vi.fn();
  const onToggleAdvanced = overrides.onToggleAdvanced ?? vi.fn();
  const onOpenIssues = overrides.onOpenIssues ?? vi.fn();
  const onOpenTask = overrides.onOpenTask ?? vi.fn();
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false } },
        })
      }
    >
      <TaskCenterPageView
        filters={{ ...DEFAULT_MY_TASK_FILTERS, ...overrides.filters }}
        onFiltersChange={onFiltersChange}
        viewerId={1}
        isAdmin={overrides.isAdmin === true}
        projects={projects}
        advancedOpen={overrides.advancedOpen === true}
        onToggleAdvanced={onToggleAdvanced}
        onOpenIssues={onOpenIssues}
        onOpenTask={onOpenTask}
        {...(overrides.adapter ? { adapter: overrides.adapter } : {})}
        {...(overrides.client ? { client: overrides.client } : {})}
      />
    </QueryClientProvider>,
  );
  return { onFiltersChange, onToggleAdvanced, onOpenIssues, onOpenTask };
};

/** 只实现弹窗会读到的方法；其余方法不该被调用。 */
const stubClient = (projects: readonly ProjectItem[]): InpulseApiClient =>
  ({
    listProjects: async () => ({ items: [...projects] }),
    listModules: async () => ({ items: [] }),
  }) as unknown as InpulseApiClient;

/**
 * 模拟服务端适配器：沿用 mock 数据集，但把结果里的 filterSupport 换成 R-3 真实能力位，
 * 以覆盖 query / relation / github 由视图在已加载页上本地收窄的分支。
 */
const serverLikeAdapter = (): MyTasksAdapter => ({
  ...MY_TASKS_MOCK_ADAPTER,
  source: "server",
  fetchMyTasks: async (input) => ({
    ...(await MY_TASKS_MOCK_ADAPTER.fetchMyTasks(input)),
    filterSupport: MY_TASKS_V1_FILTER_SUPPORT,
  }),
});

/**
 * 固定任务集合的服务端适配器：用于断言「主列表跟随工作状态分段控件」，
 * mock 数据集无法构造「0 个未完成 + 1 个已完成」这类边界。
 */
const serverLikeAdapterWith = (
  items: readonly MyTaskListItem[],
): MyTasksAdapter => ({
  ...MY_TASKS_MOCK_ADAPTER,
  source: "server",
  fetchMyTasks: async () => ({
    items: [...items],
    nextCursor: null,
    hasMore: false,
    stats: null,
    scopeCounts: null,
    leftoverCount: null,
    leftoverSample: null,
    filterSupport: MY_TASKS_V1_FILTER_SUPPORT,
  }),
});

const doneTask: MyTaskListItem = {
  taskId: 901,
  code: "INP-901",
  title: "已完成任务-901",
  projectId: 1,
  projectName: "注入项目名",
  moduleId: 11,
  moduleName: "未分类",
  featureId: null,
  featureName: null,
  scopeType: "MODULE",
  workStatus: "DONE",
  lifecycleStatus: "ACTIVE",
  priority: "NORMAL",
  dueAt: null,
  updatedAt: "2026-09-02T00:00:00.000Z",
  completedAt: "2026-09-03T00:00:00.000Z",
  creatorId: 1,
  assignee: { userId: 1, name: "特哥", avatarUrl: null },
  hasPublishedRecord: false,
  publishedRecordCount: 0,
  groupRole: null,
  githubLinkCount: 0,
  groupId: null,
};

describe("TaskCenterPageView", () => {
  it("renders the stat cards and scope tabs with a mock-data notice only", async () => {
    renderView();

    // mock 适配器只在测试与降级演示中使用：此时必须显式标注骨架数据，且不再复述接口说明。
    const notice = await screen.findByTestId("task-center-mock-notice");
    expect(notice).toHaveTextContent("骨架数据：");
    expect(screen.queryByText(/接口说明/)).toBeNull();

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

  it("keeps the list title, count and content in sync with the status segment", async () => {
    renderView({
      filters: { status: "all" },
      adapter: serverLikeAdapterWith([doneTask]),
    });

    // 回归：分段控件在「全部 / 已完成」时，主列表不能仍是恒定的「未完成 0 项」。
    expect(
      await screen.findByRole("heading", { name: "全部任务" }),
    ).toBeInTheDocument();
    expect(screen.getByText("1 项 · 服务端按任务编号倒序")).toBeInTheDocument();
    expect(screen.getByTestId("my-task-901")).toBeInTheDocument();
    expect(screen.queryByText(/没有匹配/)).toBeNull();
    expect(screen.queryByText(/已完成 1 项/)).toBeNull();
  });

  it("names the empty state after the active status segment", async () => {
    renderView({
      filters: { status: "done" },
      adapter: serverLikeAdapterWith([]),
    });

    expect(
      await screen.findByRole("heading", { name: "已完成" }),
    ).toBeInTheDocument();
    expect(screen.getByText("没有匹配的已完成任务")).toBeInTheDocument();
  });

  it("expands the done disclosure instead of hiding it behind the open empty state", async () => {
    renderView({
      filters: { status: "open" },
      adapter: serverLikeAdapterWith([doneTask]),
    });

    expect(await screen.findByText("没有匹配的未完成任务")).toBeInTheDocument();
    const disclosure = screen.getByText(/已完成 1 项/).closest("details");
    expect(disclosure).not.toBeNull();
    expect((disclosure as HTMLDetailsElement).open).toBe(true);
    // 折叠面板用明细表渲染，只能按任务标题断言；未完成任务为空时它是唯一命中。
    expect(screen.getByText("已完成任务-901")).toBeInTheDocument();
  });

  it("explains the R-3 assignee boundary in the project-scoped empty state", async () => {
    renderView({
      filters: { scope: "project", projectId: 5, status: "all" },
      adapter: serverLikeAdapterWith([]),
    });

    expect(await screen.findByText(/只返回你负责的任务/)).toBeInTheDocument();
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
        fetchTaskGroups: async () => ({
          items: [],
          nextCursor: null,
          hasMore: false,
        }),
      },
    });
    expect(
      await screen.findByText("任务列表暂时不可用，请稍后重试。"),
    ).toBeInTheDocument();
  });

  it("renders the task group panel with branches, statuses and assignees", async () => {
    renderView();

    const panel = await screen.findByRole("region", { name: "任务聚合组" });
    expect(await within(panel).findByText("1 个聚合组")).toBeInTheDocument();
    expect(within(panel).getByText("TG-001")).toBeInTheDocument();
    expect(
      within(panel).getByText("任务合并后来源分支历史保留"),
    ).toBeInTheDocument();
    expect(within(panel).getByText("进行中")).toBeInTheDocument();
    expect(within(panel).getByText("注入项目名")).toBeInTheDocument();
    expect(within(panel).getByText("主分支")).toBeInTheDocument();
    expect(within(panel).getByText("活动来源")).toBeInTheDocument();
    expect(within(panel).getAllByText("历史来源")).toHaveLength(2);
    expect(within(panel).getByText("已完成")).toBeInTheDocument();
    expect(within(panel).getByText("已取消")).toBeInTheDocument();
    expect(within(panel).getByText("旧版任务导出脚本下线")).toBeInTheDocument();
  });

  it("opens a branch task and the main task through onOpenTask", async () => {
    const { onOpenTask } = renderView();
    const user = userEvent.setup();
    const panel = await screen.findByRole("region", { name: "任务聚合组" });

    await user.click(
      await within(panel).findByRole("button", { name: /T-104/ }),
    );
    expect(onOpenTask).toHaveBeenCalledWith({
      projectId: 1,
      moduleId: 13,
      featureId: 131,
      taskId: 104,
    });

    await user.click(within(panel).getByRole("button", { name: /查看主任务/ }));
    expect(onOpenTask).toHaveBeenLastCalledWith({
      projectId: 1,
      moduleId: 12,
      featureId: 121,
      taskId: 102,
    });
  });

  it("renders the group empty state when the adapter returns no groups", async () => {
    renderView({
      adapter: {
        ...MY_TASKS_MOCK_ADAPTER,
        fetchTaskGroups: async () => ({
          items: [],
          nextCursor: null,
          hasMore: false,
        }),
      },
    });
    expect(await screen.findByText("还没有聚合组")).toBeInTheDocument();
  });

  it("keeps the group panel visible with an error alert when groups fail", async () => {
    renderView({
      adapter: {
        ...MY_TASKS_MOCK_ADAPTER,
        fetchTaskGroups: () => Promise.reject(new Error("boom")),
      },
    });
    const panel = await screen.findByRole("region", { name: "任务聚合组" });
    expect(
      await within(panel).findByText("任务列表暂时不可用，请稍后重试。"),
    ).toBeInTheDocument();
  });

  it("marks module scope, merge role and priority on task cards", async () => {
    renderView();

    const merged = await screen.findByTestId("my-task-102");
    expect(within(merged).getByText("模块级")).toBeInTheDocument();
    expect(within(merged).getByText("主任务")).toBeInTheDocument();
    expect(within(merged).getByText("高优先级")).toBeInTheDocument();
    expect(within(merged).getByText("记录 3 条")).toBeInTheDocument();

    const plain = await screen.findByTestId("my-task-101");
    expect(within(plain).getByText("紧急优先级")).toBeInTheDocument();
    expect(within(plain).queryByText(/记录/)).toBeNull();
  });

  it("offers an enabled create action that opens the cross-project form", async () => {
    renderView({ client: stubClient(projects) });
    const user = userEvent.setup();

    const create = screen.getByRole("button", { name: /新建任务/ });
    expect(create).toBeEnabled();
    expect(create).not.toHaveAttribute("title");

    await user.click(create);

    expect(
      await screen.findByRole("heading", { name: "新建任务" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("所属项目")).toBeInTheDocument();
    expect(screen.getByLabelText("所属模块")).toBeInTheDocument();
    expect(screen.getByLabelText("指派给")).toBeDisabled();
    expect(screen.getByRole("button", { name: "创建任务" })).toBeDisabled();
    expect(
      await screen.findByRole("option", { name: "注入项目名" }),
    ).toBeInTheDocument();
  });

  it("prefills the project when the view is scoped to a single project", async () => {
    renderView({
      client: stubClient(projects),
      filters: { scope: "project", projectId: 5 },
    });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /新建任务/ }));

    expect(await screen.findByLabelText("所属项目")).toHaveValue("5");
    expect(screen.getByLabelText("所属模块")).toBeEnabled();
    expect(screen.queryByRole("button", { name: "创建任务" })).toBeDisabled();
  });

  it("narrows loaded tasks locally and says so when the server has no parameter", async () => {
    renderView({
      adapter: serverLikeAdapter(),
      filters: { query: "登录" },
    });

    expect(await screen.findByTestId("my-task-101")).toBeInTheDocument();
    expect(screen.queryByTestId("my-task-102")).toBeNull();
    expect(screen.queryByTestId("my-task-106")).toBeNull();
    expect(
      await screen.findByTestId("task-center-local-note"),
    ).toHaveTextContent("关键词搜索");
  });

  it("keeps the locally computable filters usable instead of disabling them", async () => {
    renderView({
      adapter: serverLikeAdapter(),
      advancedOpen: true,
      filters: { relation: "MAIN" },
    });

    expect(screen.getByLabelText("搜索任务")).toBeEnabled();
    expect(screen.getByLabelText("合并关系")).toBeEnabled();
    expect(screen.getByLabelText("是否有 GitHub")).toBeEnabled();
    expect(screen.queryByTestId("my-task-101")).toBeNull();
    expect(await screen.findByTestId("my-task-102")).toBeInTheDocument();
  });

  it("keeps disabling the scopes the server cannot answer at all", async () => {
    renderView({ adapter: serverLikeAdapter(), isAdmin: true });

    expect(await screen.findByTestId("my-task-101")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /我创建的/ })).toBeEnabled();
    expect(screen.getByRole("tab", { name: /全部任务/ })).toBeDisabled();
    expect(screen.queryByTestId("task-center-local-note")).toBeNull();
    // 服务端适配器下不出现骨架数据提示（设计师稿 task-center.tsx 无此元素）。
    expect(screen.queryByTestId("task-center-mock-notice")).toBeNull();
    expect(screen.queryByText(/骨架数据/)).toBeNull();
  });

  it("keeps the created scope clickable under the server capability table", async () => {
    const { onFiltersChange } = renderView({
      adapter: serverLikeAdapter(),
      isAdmin: true,
      filters: { scope: "created", status: "all" },
    });

    expect(await screen.findByTestId("my-task-101")).toBeInTheDocument();
    const createdTab = screen.getByRole("tab", { name: /我创建的/ });
    expect(createdTab).toBeEnabled();
    expect(createdTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /全部任务/ })).toBeDisabled();
    expect(
      screen.getByRole("tab", { name: /全部任务/ }).getAttribute("title"),
    ).toContain("跨用户的授权范围");

    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /我负责的/ }));
    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "mine" }),
    );
  });
});
