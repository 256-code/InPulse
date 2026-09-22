import React from "react";
import { describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
    hasCompletedTask: false,
    rowVersion: 1,
    createdBy: 1,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    memberCount: 3,
    stats: {
      activeModuleCount: 2,
      activeFeatureCount: 5,
      openTaskCount: 4,
      completedTaskCount: 1,
    },
  },
  {
    id: 5,
    code: "ORD",
    name: "订单中台",
    description: "项目说明",
    status: "ACTIVE",
    hasCompletedTask: false,
    rowVersion: 1,
    createdBy: 1,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    memberCount: 2,
    stats: {
      activeModuleCount: 1,
      activeFeatureCount: 3,
      openTaskCount: 2,
      completedTaskCount: 1,
    },
  },
];

interface ViewOverrides {
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
 * 固定任务集合的服务端适配器：用于断言「主列表跟随工作状态筛选」，
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
  hasLeftoverSource: false,
};

describe("TaskCenterPageView", () => {
  it("renders the toolbar work-status filter with a mock-data notice only", async () => {
    renderView();

    // mock 适配器只在测试与降级演示中使用：此时必须显式标注骨架数据，且不再复述接口说明。
    const notice = await screen.findByTestId("task-center-mock-notice");
    expect(notice).toHaveTextContent("骨架数据：");
    expect(screen.queryByText(/接口说明/)).toBeNull();

    // 2026-09-21 定案：逾期风险条与四张统计卡整体删除，工作状态改由工具栏分段控件承担。
    expect(screen.queryByTestId("stat-my-open")).toBeNull();
    expect(document.querySelector(".stats-grid")).toBeNull();
    expect(document.querySelector(".risk-strip")).toBeNull();
    const statusFilter = screen.getByRole("group", { name: "工作状态" });
    expect(
      within(statusFilter).getByRole("button", { name: "未完成" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(statusFilter).getByRole("button", { name: "已完成" }),
    ).toHaveAttribute("aria-pressed", "false");

    // 范围分段行已整体移除：工作状态由工具栏承担，项目筛选同样在工具栏里。
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByLabelText("搜索任务")).toBeEnabled();
    const projectTrigger = screen.getByLabelText("项目").closest(".ant-select");
    expect(projectTrigger).toHaveTextContent("全部项目");
  });

  it("shows open tasks only by default and hides done and canceled", async () => {
    renderView();

    // 卡片按程度铺色：这张紧急任务同时已逾期，日期档盖过优先级档取深红。
    expect(await screen.findByTestId("my-task-101")).toHaveClass(
      "calm-task-card",
      "tone-prio-overdue",
    );
    expect(screen.queryByTestId("my-task-104")).toBeNull();
    expect(screen.queryByTestId("my-task-107")).toBeNull();
    expect(screen.queryByText(/已完成 .* 项/)).toBeNull();
  });

  it("drops the list title and count now that the toolbar filter carries the state", async () => {
    renderView({
      filters: { status: "all", todayTodo: false },
      adapter: serverLikeAdapterWith([doneTask]),
    });

    // 2026-09-20 定案：列表区块不再重复「全部任务 / 1 项 · 服务端按任务编号倒序」两行文字，
    // 工作状态只由工具栏「未完成 / 已完成」筛选表达；status=all 不属于任何档位，因此不高亮。
    // 已完成任务取绿色完成态（状态覆盖优先级）。
    expect(await screen.findByTestId("my-task-901")).toHaveClass(
      "calm-task-card",
      "tone-prio-done",
    );
    expect(screen.queryByText("1 项 · 服务端按任务编号倒序")).toBeNull();
    expect(screen.queryByRole("heading", { name: "全部任务" })).toBeNull();
    expect(screen.queryByText(/没有匹配/)).toBeNull();
    expect(screen.queryByText(/已完成 1 项/)).toBeNull();
  });
  it("列表视图：标题领衔、编号并入标题下方小字", async () => {
    renderView({
      filters: { status: "done", todayTodo: false, display: "list" },
      adapter: serverLikeAdapterWith([doneTask]),
    });

    const table = await screen.findByRole("table", { name: "跨项目任务列表" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((node) => node.textContent),
    ).toEqual([
      "任务",
      "项目",
      "归属",
      "负责人",
      "优先级",
      "截止",
      "迭代",
      "状态",
    ]);

    // 编号不再是独立列：跟在标题下面，和归属类型拼成一行；
    // 整行沿用卡片同款程度配色，已完成覆盖为绿色。
    const row = table.querySelector("tbody tr");
    expect(row).toHaveClass("tone-prio-done");
    const subtitle = row?.querySelector<HTMLElement>(".feature-list-open span");
    expect(subtitle?.textContent).toBe("INP-901 · 独立任务 · 模块级");
    expect(subtitle?.closest("td")).toBe(row?.children[0]);
  });

  it("names the empty state after the active status segment", async () => {
    renderView({
      filters: { status: "done", todayTodo: false },
      adapter: serverLikeAdapterWith([]),
    });

    expect(await screen.findByText("没有匹配的已完成任务")).toBeInTheDocument();
    // 标题行已删除，工作状态由工具栏「已完成」档的选中态表达。
    expect(screen.queryByRole("heading", { name: "已完成" })).toBeNull();
    expect(
      within(screen.getByRole("group", { name: "工作状态" })).getByRole(
        "button",
        { name: "已完成" },
      ),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("expands the done disclosure instead of hiding it behind the open empty state", async () => {
    renderView({
      filters: { status: "open", todayTodo: false },
      adapter: serverLikeAdapterWith([doneTask]),
    });

    expect(await screen.findByText("没有匹配的未完成任务")).toBeInTheDocument();
    const disclosure = screen.getByText(/已完成 1 项/).closest("details");
    expect(disclosure).not.toBeNull();
    expect((disclosure as HTMLDetailsElement).open).toBe(true);
    // 折叠面板用明细表渲染，只能按任务标题断言；未完成任务为空时它是唯一命中。
    expect(screen.getByText("已完成任务-901")).toBeInTheDocument();
  });

  it("explains the project-wide empty state", async () => {
    renderView({
      filters: { scope: "project", projectId: 5, status: "all" },
      adapter: serverLikeAdapterWith([]),
    });

    expect(
      await screen.findByText(/当前项目没有符合条件的任务/),
    ).toBeInTheDocument();
  });

  it("resolves project names from the injected project port", async () => {
    renderView();
    const card = await screen.findByTestId("my-task-101");
    expect(card).toHaveTextContent("注入项目名");
  });

  it("reports the project filter through onFiltersChange", async () => {
    const { onFiltersChange } = renderView();

    // 默认「全部项目」= 不加项目条件，保持跨项目视图（与遗留问题页同口径）。
    const trigger = screen.getByLabelText("项目").closest(".ant-select");
    if (!trigger) {
      throw new Error("select trigger not found for 项目");
    }
    expect(trigger).toHaveTextContent("全部项目");

    fireEvent.mouseDown(trigger);
    fireEvent.click(await screen.findByTitle("订单中台"));
    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 5 }),
    );
  });

  it("opens no read-only detail dialog and reports the archive location for a feature task card", async () => {
    const { onOpenTask } = renderView();
    const card = await screen.findByTestId("my-task-101");
    await userEvent.click(card);

    // 任务中心不再弹出只读详情：写操作只在功能档案中，点击卡片即交由页面定位。
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "关闭" })).toBeNull();
    expect(onOpenTask).toHaveBeenCalledWith({
      projectId: 1,
      moduleId: 11,
      featureId: 111,
      taskId: 101,
    });
  });

  it("reports a module-level archive location for a task without a feature", async () => {
    const { onOpenTask } = renderView({
      adapter: serverLikeAdapterWith([doneTask]),
      filters: { status: "done" },
    });
    await userEvent.click(await screen.findByTestId("my-task-901"));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onOpenTask).toHaveBeenCalledWith({
      projectId: 1,
      moduleId: 11,
      featureId: null,
      taskId: 901,
    });
  });

  it("reports the work-status change from the toolbar filter", async () => {
    const { onFiltersChange } = renderView();
    const user = userEvent.setup();

    const statusFilter = screen.getByRole("group", { name: "工作状态" });
    // 切到「已完成」：工作状态写入 URL，与工作状态无关的逾期 / 今日待办口径一并清除。
    await user.click(
      within(statusFilter).getByRole("button", { name: "已完成" }),
    );
    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "done",
        overdue: false,
        todayTodo: false,
      }),
    );
    await user.click(
      within(statusFilter).getByRole("button", { name: "未完成" }),
    );
    expect(onFiltersChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "open" }),
    );
  });

  it("uses the plain open wording for the default view now that today-todo has no entry", async () => {
    renderView({ adapter: serverLikeAdapterWith([]) });

    // 缺省口径是「全部未完成任务」：空态就是未完成的措辞，不再出现「今天没有待办任务」。
    expect(await screen.findByText("没有匹配的未完成任务")).toBeInTheDocument();
    expect(screen.queryByText("今天没有待办任务")).toBeNull();
  });

  it("explains the today-todo empty state instead of reusing the open wording", async () => {
    renderView({
      adapter: serverLikeAdapterWith([]),
      filters: { todayTodo: true },
    });

    // 今日待办是「未完成」的子集，空态必须点明它更窄，否则看起来像漏了任务。
    expect(await screen.findByText("今天没有待办任务")).toBeInTheDocument();
    expect(screen.queryByText("没有匹配的未完成任务")).toBeNull();
  });

  it("reports the query and the advanced toggle", async () => {
    const { onFiltersChange, onToggleAdvanced } = renderView();
    const user = userEvent.setup();

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
    expect(within(merged).getByText("高")).toBeInTheDocument();
    expect(within(merged).getByTitle("优先级：高")).toBeInTheDocument();
    expect(within(merged).getByText("记录 3 条")).toBeInTheDocument();

    const plain = await screen.findByTestId("my-task-101");
    expect(within(plain).getByText("紧急")).toBeInTheDocument();
    expect(within(plain).getByTitle("优先级：紧急")).toBeInTheDocument();
    expect(within(plain).queryByText(/记录/)).toBeNull();
  });

  it("keeps every priority label within two characters in the filter", async () => {
    renderView();

    const field = await screen.findByLabelText("优先级");
    const trigger = field.closest(".ant-select");
    if (!trigger) {
      throw new Error("select trigger not found for 优先级");
    }
    fireEvent.mouseDown(trigger);
    const options = await screen.findAllByRole("option");
    const labels = options.map((option) => option.textContent?.trim() ?? "");
    expect(labels).toEqual(["全部", "紧急", "高", "普通", "低"]);
    for (const label of labels) {
      expect([...label].length).toBeLessThanOrEqual(2);
    }
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
    const projectField = screen.getByLabelText("所属项目");
    expect(projectField).toBeInTheDocument();
    expect(screen.getByLabelText("所属模块")).toBeInTheDocument();
    expect(screen.getByLabelText("指派给")).toBeDisabled();
    expect(screen.getByRole("button", { name: "创建任务" })).toBeDisabled();
    const projectTrigger = projectField.closest(".ant-select");
    if (!projectTrigger) {
      throw new Error("select trigger not found for 所属项目");
    }
    fireEvent.mouseDown(projectTrigger);
    expect(await screen.findByTitle("注入项目名")).toBeInTheDocument();
  });

  it("prefills the project when the view is scoped to a single project", async () => {
    renderView({
      client: stubClient(projects),
      filters: { scope: "project", projectId: 5 },
    });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /新建任务/ }));

    const projectField = await screen.findByLabelText("所属项目");
    await waitFor(() =>
      expect(projectField.closest(".ant-select")).toHaveTextContent("订单中台"),
    );
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

  it("keeps the project filter and the locally computable filters usable", async () => {
    renderView({ adapter: serverLikeAdapter() });

    expect(await screen.findByTestId("my-task-101")).toBeInTheDocument();
    expect(screen.getByLabelText("项目")).toBeEnabled();
    expect(screen.getByLabelText("搜索任务")).toBeEnabled();
    expect(screen.queryByTestId("task-center-local-note")).toBeNull();
    // 服务端适配器下不出现骨架数据提示（设计师稿 task-center.tsx 无此元素）。
    expect(screen.queryByTestId("task-center-mock-notice")).toBeNull();
    expect(screen.queryByText(/骨架数据/)).toBeNull();
  });

  it("renders a server-provided scope without scope tabs or stat cards", async () => {
    renderView({
      adapter: serverLikeAdapter(),
      filters: { scope: "created", status: "all" },
    });

    // URL 里仍可携带 scope=created（任务中心不删除该参数），页面按工具栏工作状态渲染
    // 列表：不再有任何范围 tab，也不再有统计卡。
    expect(await screen.findByTestId("my-task-101")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "全部任务" })).toBeNull();
    expect(screen.queryByTestId("stat-created")).toBeNull();
    expect(document.querySelector(".stats-grid")).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tab", { name: /全部任务/ })).toBeNull();
    // status=all 不属于「未完成 / 已完成」任何一档：两个档位都不高亮。
    const statusFilter = screen.getByRole("group", { name: "工作状态" });
    expect(
      within(statusFilter).getByRole("button", { name: "未完成" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      within(statusFilter).getByRole("button", { name: "已完成" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("整卡铺红：已逾期深红、今天到期橙红，已完成不参与红档", async () => {
    const now = new Date();
    const dayOffset = (offsetDays: number) =>
      new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + offsetDays,
        18,
        0,
        0,
      ).toISOString();
    const openItem = (over: Partial<MyTaskListItem>): MyTaskListItem => ({
      ...doneTask,
      workStatus: "TODO",
      completedAt: null,
      dueAt: null,
      ...over,
    });
    renderView({
      adapter: serverLikeAdapterWith([
        openItem({ taskId: 801, code: "INP-801", dueAt: dayOffset(-3) }),
        openItem({ taskId: 802, code: "INP-802", dueAt: dayOffset(0) }),
        openItem({
          taskId: 803,
          code: "INP-803",
          workStatus: "DONE",
          completedAt: "2026-09-03T00:00:00.000Z",
          dueAt: dayOffset(-3),
        }),
      ]),
      filters: { status: "all" },
    });
    const cardOf = (taskId: number): HTMLElement =>
      screen.getByTestId("my-task-" + taskId);
    await screen.findByTestId("my-task-801");
    // 卡片整卡铺红：逾期深红、今天到期橙红（tone 色值见 design-system.css）。
    expect(cardOf(801)).toHaveClass("calm-task-card", "tone-prio-overdue");
    expect(cardOf(802)).toHaveClass("calm-task-card", "tone-prio-soon");
    // 已完成不参与红档：状态色优先，卡上也不再挂红色日期签。
    expect(cardOf(803)).toHaveClass("calm-task-card", "tone-prio-done");
    expect(within(cardOf(803)).getByTitle(/^截止：/).className).toBe("");
  });

  it("列表视图是白底表面：整卡不铺红，只把截止列染成深红 / 橙红", async () => {
    const now = new Date();
    const dayOffset = (offsetDays: number) =>
      new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + offsetDays,
        18,
        0,
        0,
      ).toISOString();
    const openItem = (over: Partial<MyTaskListItem>): MyTaskListItem => ({
      ...doneTask,
      workStatus: "TODO",
      completedAt: null,
      dueAt: null,
      ...over,
    });
    renderView({
      adapter: serverLikeAdapterWith([
        openItem({ taskId: 811, code: "INP-811", dueAt: dayOffset(-3) }),
        openItem({ taskId: 812, code: "INP-812", dueAt: dayOffset(0) }),
        openItem({
          taskId: 813,
          code: "INP-813",
          workStatus: "DONE",
          completedAt: "2026-09-03T00:00:00.000Z",
          dueAt: dayOffset(-3),
        }),
      ]),
      filters: { status: "all", display: "list" },
    });
    const table = await screen.findByRole("table", { name: "跨项目任务列表" });
    const dueIndex = within(table)
      .getAllByRole("columnheader")
      .findIndex((node) => node.textContent === "截止");
    const dueCellOf = (code: string): HTMLElement => {
      const row = screen
        .getByText(new RegExp("^" + code))
        .closest("tr") as HTMLElement;
      return within(row).getAllByRole("cell")[dueIndex] as HTMLElement;
    };
    expect(dueCellOf("INP-811")).toHaveClass("due-overdue");
    expect(dueCellOf("INP-812")).toHaveClass("due-soon");
    // 已完成不参与红档，截止列回到默认字色。
    expect(dueCellOf("INP-813").className).toBe("");
  });
});

it("clears overdue when opening completed tasks", async () => {
  const { onFiltersChange } = renderView({ filters: { overdue: true } });
  await userEvent.click(
    within(screen.getByRole("group", { name: "工作状态" })).getByRole(
      "button",
      { name: "已完成" },
    ),
  );
  expect(onFiltersChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ status: "done", overdue: false }),
  );
});

it("loads the next page and keeps previously loaded tasks", async () => {
  const fetchMyTasks = vi.fn(
    async (input: Parameters<MyTasksAdapter["fetchMyTasks"]>[0]) => ({
      ...(await MY_TASKS_MOCK_ADAPTER.fetchMyTasks(input)),
      items: [
        {
          ...doneTask,
          taskId: input.cursor ? 902 : 901,
          title: input.cursor ? "第二页任务" : "第一页任务",
          workStatus: "TODO" as const,
        },
      ],
      nextCursor: input.cursor ? null : "next-page",
      hasMore: !input.cursor,
    }),
  );
  renderView({ adapter: { ...MY_TASKS_MOCK_ADAPTER, fetchMyTasks } });
  await userEvent.click(
    await screen.findByRole("button", { name: "加载更多任务" }),
  );
  expect(await screen.findByText("第二页任务")).toBeVisible();
  expect(screen.getByText("第一页任务")).toBeVisible();
  expect(fetchMyTasks).toHaveBeenLastCalledWith(
    expect.objectContaining({ cursor: "next-page" }),
  );
  expect(screen.queryByRole("button", { name: "加载更多任务" })).toBeNull();
});
