import React, { useMemo, useState } from "react";
import { Alert, Button, Spin } from "antd";
import {
  createApiClient,
  type InpulseApiClient,
  type ProjectItem,
} from "@generated/api";
import {
  InpulseIcon,
  type InpulseIconName,
} from "@features/common/components/InpulseIcon";
import {
  CalmBadge,
  CalmEmptyState,
  CalmSegmented,
  CalmSectionTitle,
} from "@features/common/components/Calm";
import { CalmSelect } from "@features/common/components/CalmSelect";
import { priorityDotColor } from "@features/common/priority-select-option";
import { projectSelectOption } from "@features/common/project-select-option";
import { MY_TASKS_MOCK_ADAPTER } from "./my-tasks-mock";
import {
  describeMyTasksError,
  useMyTaskGroupsQuery,
  useMyTasksQuery,
} from "./my-tasks-query";
import type { TaskLocation } from "@features/tasks/task-links";
import {
  countActiveMyTaskFilters,
  DEFAULT_MY_TASK_FILTERS,
} from "./my-tasks-url";
import {
  listMyTasksV1Gaps,
  matchesMyTasksLocalFilters,
  MY_TASKS_V1_LOCAL_FILTER_SUPPORT,
} from "./my-tasks-v1-query";
import { formatDayIso, isBeforeTodayIso, isTodayIso } from "./my-tasks-time";
import { GlobalTaskCreateModal } from "@features/tasks/GlobalTaskCreateModal";
import { TaskGroupDetailModal } from "@features/task-groups/TaskGroupDetailModal";
import { createTaskGroupServerAdapter } from "@features/task-groups/task-groups-server";
import {
  MY_TASKS_FULL_FILTER_SUPPORT,
  type MyTaskFilters,
  type MyTaskGithubFilter,
  type MyTaskLevel,
  type MyTaskListItem,
  type MyTaskPriority,
  type MyTaskRecordFilter,
  type MyTaskRelation,
  type MyTaskScope,
  type MyTaskStatusFilter,
  type MyTasksAdapter,
  type MyTasksFilterGap,
  type MyTasksFilterSupport,
  type MyTaskWorkStatus,
} from "./my-tasks-types";

const scopeOrder: readonly MyTaskScope[] = [
  "mine",
  "created",
  "project",
  "all",
];

const scopeLabels: Record<MyTaskScope, string> = {
  mine: "我负责的",
  created: "我创建的",
  project: "按项目",
  all: "全部任务",
};

/** 视图说明；`project` 一栏按 R-3 的真实能力收窄措辞：R-3 只服务当前会话用户的
 * 自指维度（负责 / 创建），「按项目查看全部任务」需要项目任务列表路由，属延后项。 */
const scopeHints: Record<MyTaskScope, string> = {
  mine: "我负责的任务；项目成员平权，任何人都可以推进与更新。",
  created: "我创建的任务；即使指派给他人，也会在这里跟踪。",
  project: "查看所选项目内所有成员的任务。",
  all: "管理员视图：查看全部项目的任务。",
};

/** 可用但能力受限的范围，需要显式说明服务端边界，不能让视图看起来返回了全部任务。 */
const scopeTitles: Partial<Record<MyTaskScope, string>> = {
  project: "查看项目内所有成员的任务",
};

/** 仍不可用的范围与原因；禁用按钮必须有可读原因，不能让用户以为界面坏了。 */
const scopeDisabledTitles: Partial<Record<MyTaskScope, string>> = {
  all: "全部任务仅对系统管理员开放。",
};

const statusLabels: Record<MyTaskWorkStatus, string> = {
  TODO: "未完成",
  DONE: "已完成",
  CANCELED: "已取消",
};

const statusTone: Record<MyTaskWorkStatus, "blue" | "green" | "gray"> = {
  TODO: "blue",
  DONE: "green",
  CANCELED: "gray",
};

const sourceKindLabels: Record<"ACTIVE" | "HISTORICAL", string> = {
  ACTIVE: "活动来源",
  HISTORICAL: "历史来源",
};

/** 来源分支标签：sourceKind 缺失时退回通用「来源分支」，不虚构活动/历史。 */
function sourceKindLabel(sourceKind: "ACTIVE" | "HISTORICAL" | null): string {
  return sourceKind === null ? "来源分支" : sourceKindLabels[sourceKind];
}

const priorityLabels: Record<MyTaskPriority, string> = {
  LOW: "低",
  NORMAL: "普通",
  HIGH: "高",
  URGENT: "紧急",
};

const priorityTone: Record<MyTaskPriority, "gray" | "blue" | "amber" | "red"> =
  {
    LOW: "gray",
    NORMAL: "blue",
    HIGH: "amber",
    URGENT: "red",
  };

const priorityOrder: readonly MyTaskPriority[] = [
  "URGENT",
  "HIGH",
  "NORMAL",
  "LOW",
];

const statusOptions = [
  { value: "open" as const, label: "未完成" },
  { value: "done" as const, label: "已完成" },
  { value: "all" as const, label: "全部" },
];

/**
 * 列表区块标题与空态必须跟随工作状态分段控件：服务端按 workStatus 收窄，
 * 只把「未完成」主列表做标题、把其余结果留在折叠面板里，会让「已完成 / 全部」
 * 看起来像没有数据（标题恒为「未完成 0 项」）。
 */
const listTitles: Record<MyTaskStatusFilter, string> = {
  open: "未完成",
  done: "已完成",
  all: "全部任务",
};

const listEmptyTitles: Record<MyTaskStatusFilter, string> = {
  open: "没有匹配的未完成任务",
  done: "没有匹配的已完成任务",
  all: "没有匹配的任务",
};

const displayOptions = [
  { value: "cards" as const, label: "卡片" },
  { value: "list" as const, label: "列表" },
];

const filterGapLabels: Record<MyTasksFilterGap, string> = {
  "scope:created": "我创建的",
  "scope:all": "全部任务",
  "scope:project-without-id": "全部可访问项目",
  "filter:priority": "优先级",
  "filter:relation": "合并关系",
  "filter:github": "GitHub 关联",
  "filter:query": "关键词搜索",
  "filter:canceled-with-open": "已取消与未完成合并显示",
};

function isScopeFilterSupported(
  scope: MyTaskScope,
  support: MyTasksFilterSupport,
): boolean {
  if (scope === "created") return support["scope:created"];
  if (scope === "all") return support["scope:all"];
  return true;
}

/**
 * 本地筛选提示：服务端没有对应参数、只对已加载页生效时必须显式说明，
 * 否则会被读成服务端全量收敛。
 */
function localFilterNote(
  localGaps: readonly MyTasksFilterGap[],
  loaded: number,
): string {
  return (
    "以下条件在已加载的 " +
    loaded +
    " 条任务上本地筛选（服务端暂未提供参数）：" +
    localGaps.map((gap) => filterGapLabels[gap]).join("、") +
    "；点“加载更多”可扩大范围。"
  );
}

function dueLabel(item: MyTaskListItem): string {
  if (item.dueAt === null) return "未设置截止";
  if (item.workStatus === "TODO" && isBeforeTodayIso(item.dueAt))
    return "已逾期 " + formatDayIso(item.dueAt);
  if (isTodayIso(item.dueAt)) return "今天截止";
  return formatDayIso(item.dueAt);
}

function isOverdue(item: MyTaskListItem): boolean {
  return (
    item.workStatus === "TODO" &&
    typeof item.dueAt === "string" &&
    isBeforeTodayIso(item.dueAt)
  );
}

export interface TaskCenterPageViewProps {
  readonly filters: MyTaskFilters;
  readonly onFiltersChange: (next: MyTaskFilters) => void;
  readonly viewerId: number | null;
  readonly isAdmin: boolean;
  readonly projects: readonly ProjectItem[];
  readonly advancedOpen: boolean;
  readonly onToggleAdvanced: () => void;
  readonly onOpenIssues: () => void;
  readonly onOpenTask?: (task: TaskLocation) => void;
  readonly adapter?: MyTasksAdapter;
  /** 与页面共用同一个生成客户端；缺省时弹窗自行创建。 */
  readonly client?: InpulseApiClient | undefined;
}

/**
 * F-32 任务中心页面视图。数据来自注入的 adapter：页面默认注入 server
 * adapter（R-3 listMyTasks），mock 只用于测试与降级演示；项目名等公共字段
 * 来自 A 的 listProjects 端口（在页面层注入）。
 * 契约缺口（统计、范围计数、遗留问题、优先级/截止时间等）按适配器声明的
 * filterSupport 与可选字段显式降级：禁用或标注，不虚构数值。
 */
export const TaskCenterPageView: React.FC<TaskCenterPageViewProps> = ({
  filters,
  onFiltersChange,
  viewerId,
  isAdmin,
  projects,
  advancedOpen,
  onToggleAdvanced,
  onOpenIssues,
  onOpenTask,
  adapter,
  client,
}) => {
  const activeAdapter = adapter ?? MY_TASKS_MOCK_ADAPTER;
  // 聚合组详情经 C 域 R-1 / R-4 读取，与任务中心自己的 MyTasks 适配器无关。
  const api = useMemo(() => client ?? createApiClient(), [client]);
  const groupAdapter = useMemo(() => createTaskGroupServerAdapter(api), [api]);
  /** 当前打开的聚合组（null 表示弹层关闭）：卡片不再跳转详情页。 */
  const [openGroupId, setOpenGroupId] = useState<number | null>(null);
  const taskQuery = useMyTasksQuery({
    filters,
    viewerId,
    adapter: activeAdapter,
  });
  const groupsQuery = useMyTaskGroupsQuery({
    projectId: filters.scope === "project" ? filters.projectId : null,
    adapter: activeAdapter,
  });
  const groups =
    groupsQuery.data?.pages.flatMap((page) => [...page.items]) ?? [];
  const result = taskQuery.data;
  const items = result?.items ?? [];
  const stats = result?.stats ?? null;
  const scopeCounts = result?.scopeCounts ?? null;
  const leftoverCount = result?.leftoverCount ?? null;
  const leftoverSample = result?.leftoverSample ?? null;
  const filterSupport: MyTasksFilterSupport =
    result?.filterSupport ?? MY_TASKS_FULL_FILTER_SUPPORT;
  /**
   * 服务端缺口的两个分支：可本地计算的条件（relation / github / query）保持控件可用，
   * 只在提示条里说明"仅对已加载页生效"；无法本地计算的条件（scope:created /
   * scope:all）必须继续禁用，由 tab 的 title 说明原因。
   */
  const localGaps = listMyTasksV1Gaps(filters).filter(
    (gap) => !filterSupport[gap] && MY_TASKS_V1_LOCAL_FILTER_SUPPORT[gap],
  );
  const enabled = (gap: MyTasksFilterGap): boolean =>
    filterSupport[gap] || MY_TASKS_V1_LOCAL_FILTER_SUPPORT[gap];
  const projectNames = new Map<number, string>(
    projects.map((project) => [project.id, project.name]),
  );
  const projectNameOf = (item: MyTaskListItem): string =>
    projectNames.get(item.projectId) ?? item.projectName;
  const visibleItems = items.filter((item) =>
    matchesMyTasksLocalFilters(item, filters, filterSupport),
  );
  const openItems = visibleItems.filter((item) => item.workStatus === "TODO");
  const doneItems = visibleItems.filter((item) => item.workStatus === "DONE");
  const canceledItems = visibleItems.filter(
    (item) => item.workStatus === "CANCELED",
  );
  const overdueItem = openItems.find((item) => isOverdue(item)) ?? null;
  /**
   * 主列表取当前工作状态对应的集合：「已完成 / 全部」的结果必须直接可见，
   * 否则切换分段控件时页面上仍只有「未完成 0 项」与空态。
   */
  const primaryItems =
    filters.status === "done"
      ? doneItems
      : filters.status === "all"
        ? visibleItems
        : openItems;
  const listTitle = listTitles[filters.status];
  const listEmptyTitle = listEmptyTitles[filters.status];
  /** 空态按范围说明服务端边界：R-3 的负责人固定为当前会话用户。 */
  const listEmptyDescription =
    filters.scope === "project"
      ? "当前项目没有符合条件的任务，可调整筛选或新建任务。"
      : "调整筛选条件，或到对应功能页创建新任务。";
  const activeFilterCount = countActiveMyTaskFilters(filters);
  const [createOpen, setCreateOpen] = useState(false);

  const update = (patch: Partial<MyTaskFilters>) => {
    onFiltersChange({
      ...filters,
      ...(patch.status !== undefined ? { overdue: false } : {}),
      ...patch,
    });
  };

  const handleScopeChange = (scope: MyTaskScope) => {
    if (scope === "project") {
      update({
        scope,
        overdue: false,
        projectId: filters.projectId ?? projects[0]?.id ?? null,
      });
      return;
    }
    update({ scope, overdue: false });
  };

  const statCards: ReadonlyArray<{
    readonly key: string;
    readonly label: string;
    readonly value: number | string;
    readonly hint: string;
    readonly icon: InpulseIconName;
    readonly tone: string;
    readonly onSelect: () => void;
  }> = [
    {
      key: "my-open",
      label: "我负责的未完成",
      value: stats === null ? "—" : stats.myOpen,
      hint: stats === null ? "聚合统计暂未接入" : "点击切换到我的未完成任务",
      icon: "clipboard",
      tone: "blue",
      onSelect: () => update({ scope: "mine", status: "open" }),
    },
    {
      key: "due-today",
      label: "今天截止",
      value: stats === null ? "—" : stats.dueToday,
      hint:
        stats === null
          ? "聚合统计暂未接入"
          : stats.dueToday > 0
            ? "优先安排今天的工作"
            : "今天没有到期任务",
      icon: "calendar",
      tone: "violet",
      onSelect: () => update({ scope: "mine", status: "open", query: "" }),
    },
    {
      key: "overdue",
      label: "已逾期",
      value: stats === null ? "—" : stats.overdue,
      hint:
        stats === null
          ? "聚合统计暂未接入"
          : stats.overdue > 0
            ? "需要协调依赖或改期"
            : "没有逾期任务",
      icon: "alert",
      tone: stats !== null && stats.overdue > 0 ? "red" : "green",
      onSelect: () =>
        update({
          scope: "mine",
          status: "open",
          overdue: true,
          projectId:
            filters.scope === "project" || filters.overdue
              ? filters.projectId
              : null,
          query: "",
          priority: null,
          level: null,
          relation: null,
          hasRecord: null,
          hasGithub: null,
        }),
    },
    {
      key: "completed",
      label: "本月完成",
      value: stats === null ? "—" : stats.completedThisMonth,
      hint: stats === null ? "聚合统计暂未接入" : "已完成任务不会消失",
      icon: "check",
      tone: "green",
      onSelect: () => update({ scope: "mine", status: "done" }),
    },
  ];

  /**
   * 任务中心只做跨项目查看与定位，不复制功能档案的写入口（状态推进 / 生成迭代记录 /
   * 合并 / 关联链接 / 任务编辑只在任务详情弹窗中提供）。卡片与列表行点击后经
   * onOpenTask 交回页面，由 TasksPage 在当前页面就地打开功能档案同款的任务详情
   * 弹窗（不改变地址栏、不跳转），写入口仍只有这一个。
   */
  const openTask = (item: MyTaskListItem) =>
    onOpenTask?.({
      projectId: item.projectId,
      moduleId: item.moduleId,
      featureId: item.featureId,
      taskId: item.taskId,
    });

  const relationLabelOf = (item: MyTaskListItem): string => {
    if (item.groupRole === "MAIN") return "主任务";
    if (item.groupRole === "SOURCE") return "来源任务";
    return "独立任务";
  };

  const renderCard = (item: MyTaskListItem) => {
    const due = dueLabel(item);
    return (
      <button
        type="button"
        className="calm-task-card"
        key={item.taskId}
        data-testid={"my-task-" + item.taskId}
        onClick={() => openTask(item)}
      >
        <div className="calm-card-top">
          <span className="task-id">{item.code}</span>
          <span className="task-card-badges">
            {item.scopeType === "MODULE" ? (
              <CalmBadge tone="violet">模块级</CalmBadge>
            ) : null}
            {item.groupRole !== null ? (
              <CalmBadge tone={item.groupRole === "MAIN" ? "violet" : "cyan"}>
                {item.groupRole === "MAIN" ? "主任务" : "来源任务"}
              </CalmBadge>
            ) : null}
            {item.hasLeftoverSource ? (
              <CalmBadge tone="amber" title="由遗留问题转换而来的跟进任务">
                遗留问题
              </CalmBadge>
            ) : null}
            <CalmBadge tone={statusTone[item.workStatus]}>
              {statusLabels[item.workStatus]}
            </CalmBadge>
          </span>
        </div>
        <h3>{item.title}</h3>
        <p className="task-belonging">
          {projectNameOf(item) +
            " · " +
            item.moduleName +
            (item.featureName === null ? "" : " · " + item.featureName)}
        </p>
        <div className="calm-card-bottom">
          <span title={"负责人：" + item.assignee.name}>
            <InpulseIcon name="users" size={14} />
            {item.assignee.name}
          </span>
          <span title={"截止：" + due}>
            <InpulseIcon name="clock" size={14} />
            {due}
          </span>
        </div>
        <div className="task-card-footer">
          <span className="task-card-counts">
            <CalmBadge
              tone={priorityTone[item.priority]}
              title={`优先级：${priorityLabels[item.priority]}`}
            >
              {priorityLabels[item.priority]}
            </CalmBadge>
            {item.publishedRecordCount > 0 ? (
              <span title={item.publishedRecordCount + " 条已发布迭代记录"}>
                <InpulseIcon name="gitBranch" size={13} />
                记录 {item.publishedRecordCount} 条
              </span>
            ) : null}
          </span>
        </div>
      </button>
    );
  };

  const renderTable = (rows: readonly MyTaskListItem[]) => (
    <div className="feature-list-scroll">
      <table className="feature-list-table">
        <caption className="sr-only">跨项目任务列表</caption>
        <thead>
          <tr>
            <th scope="col">编号</th>
            <th scope="col">任务</th>
            <th scope="col">项目</th>
            <th scope="col">归属</th>
            <th scope="col">负责人</th>
            <th scope="col">优先级</th>
            <th scope="col">截止</th>
            <th scope="col">迭代</th>
            <th scope="col">状态</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => (
            <tr key={item.taskId}>
              <td>
                <span className="task-id">{item.code}</span>
              </td>
              <td>
                <button
                  type="button"
                  className="feature-list-open"
                  onClick={() => openTask(item)}
                >
                  <strong>{item.title}</strong>
                  <span>
                    {relationLabelOf(item)}
                    {item.scopeType === "MODULE" ? " · 模块级" : ""}
                    {item.hasLeftoverSource ? " · 遗留问题" : ""}
                  </span>
                </button>
              </td>
              <td>{projectNameOf(item)}</td>
              <td>
                {item.moduleName +
                  (item.featureName === null ? "" : " / " + item.featureName)}
              </td>
              <td>{item.assignee.name}</td>
              <td>
                <CalmBadge tone={priorityTone[item.priority]}>
                  {priorityLabels[item.priority]}
                </CalmBadge>
              </td>
              <td className={isOverdue(item) ? "due-overdue" : undefined}>
                {dueLabel(item) ?? "—"}
              </td>
              <td>{item.publishedRecordCount}</td>
              <td>
                <CalmBadge tone={statusTone[item.workStatus]}>
                  {statusLabels[item.workStatus]}
                </CalmBadge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <section
      className="task-center"
      aria-label="任务中心"
      data-testid="task-center"
    >
      <div className="page-header">
        <div>
          <h1>任务中心</h1>
          <p>
            所有工作从这里展开：任务负责推进，完成后沉淀为迭代记录，遗留问题继续转为新任务。
          </p>
        </div>
        <div className="catalog-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={onOpenIssues}
          >
            <InpulseIcon name="alert" size={15} />
            遗留问题
            {leftoverCount !== null && leftoverCount > 0
              ? " " + leftoverCount
              : ""}
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => setCreateOpen(true)}
          >
            <InpulseIcon name="plus" size={16} />
            新建任务
          </button>
        </div>
      </div>

      {activeAdapter.source === "mock" ? (
        <div className="skeleton-note" data-testid="task-center-mock-notice">
          <InpulseIcon name="alert" size={16} />
          <span>
            <strong>骨架数据：</strong>
            {activeAdapter.notice}
          </span>
        </div>
      ) : null}

      {(stats !== null && stats.overdue > 0) ||
      (leftoverCount !== null && leftoverCount > 0) ? (
        <div className="risk-strip">
          {stats !== null && stats.overdue > 0 ? (
            <button
              type="button"
              className="risk-banner"
              onClick={() =>
                update({
                  scope: "mine",
                  status: "open",
                  overdue: true,
                  projectId:
                    filters.scope === "project" || filters.overdue
                      ? filters.projectId
                      : null,
                  query: "",
                  priority: null,
                  level: null,
                  relation: null,
                  hasRecord: null,
                  hasGithub: null,
                })
              }
            >
              <InpulseIcon name="alert" size={20} />
              <span>
                <strong>{stats.overdue} 项我负责的任务已逾期</strong>
                <small>
                  {overdueItem === null
                    ? "切换到我的任务查看明细"
                    : overdueItem.code +
                      " " +
                      overdueItem.title +
                      " · " +
                      (dueLabel(overdueItem) ?? "—")}
                </small>
              </span>
              <span className="risk-action">
                处理
                <InpulseIcon name="chevronRight" size={16} />
              </span>
            </button>
          ) : null}
          {leftoverCount !== null && leftoverCount > 0 ? (
            <button
              type="button"
              className="risk-banner risk-banner-amber"
              onClick={onOpenIssues}
            >
              <InpulseIcon name="alert" size={20} />
              <span>
                <strong>{leftoverCount} 条遗留问题尚未闭环</strong>
                <small>
                  {leftoverSample === null
                    ? "在遗留问题页继续处理"
                    : "来自 " +
                      leftoverSample.recordCode +
                      " " +
                      leftoverSample.summary}
                </small>
              </span>
              <span className="risk-action">
                转为任务
                <InpulseIcon name="chevronRight" size={16} />
              </span>
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="stats-grid">
        {statCards.map((card) => (
          <button
            key={card.key}
            type="button"
            className="stat-card stat-card-button"
            data-testid={"stat-" + card.key}
            onClick={card.onSelect}
          >
            <span className={"stat-icon " + card.tone}>
              <InpulseIcon name={card.icon} size={19} />
            </span>
            <span className="stat-body">
              <span>{card.label}</span>
              <strong>{card.value}</strong>
              <small>{card.hint}</small>
            </span>
          </button>
        ))}
      </div>

      {filters.overdue && (
        <p>
          仅显示已逾期任务
          {filters.projectId !== null
            ? ` · ${projectNames.get(filters.projectId) ?? "当前项目"}`
            : ""}{" "}
          <button type="button" onClick={() => update({ overdue: false })}>
            清除逾期筛选
          </button>
        </p>
      )}
      <div className="task-view-tabs" role="tablist" aria-label="任务范围">
        {scopeOrder
          .filter((scope) => scope !== "all" || isAdmin)
          .map((scope) => {
            const supported = isScopeFilterSupported(scope, filterSupport);
            return (
              <button
                key={scope}
                type="button"
                role="tab"
                aria-selected={filters.scope === scope}
                className={filters.scope === scope ? "selected" : ""}
                onClick={() => handleScopeChange(scope)}
                disabled={!supported}
                title={
                  supported
                    ? scopeTitles[scope]
                    : (scopeDisabledTitles[scope] ??
                      "服务端聚合读未提供该范围，对应 tab 保持禁用")
                }
              >
                {scopeLabels[scope]}
                {scopeCounts === null ? null : (
                  <span>{scopeCounts[scope]}</span>
                )}
                {scope === "all" ? <small>管理员</small> : null}
              </button>
            );
          })}
      </div>
      <p className="view-description">{scopeHints[filters.scope]}</p>

      {filters.scope === "project" ? (
        <label className="inline-picker">
          选择项目
          <CalmSelect
            value={filters.projectId === null ? "" : String(filters.projectId)}
            onChange={(next) => update({ projectId: Number(next) || null })}
            options={projects.map((project) => projectSelectOption(project))}
            appearance="rich"
            placeholder="请选择项目"
            ariaLabel="选择项目"
          />
        </label>
      ) : null}

      <div className="toolbar task-toolbar">
        <div className="task-search">
          <InpulseIcon name="search" size={16} />
          <input
            value={filters.query}
            placeholder="搜索任务编号、标题、描述、归属或负责人"
            aria-label="搜索任务"
            disabled={!enabled("filter:query")}
            onChange={(event) => update({ query: event.target.value })}
          />
        </div>
        <CalmSegmented
          label="工作状态"
          value={filters.status}
          options={statusOptions}
          onChange={(status) => update({ status })}
        />
        <CalmSelect
          ariaLabel="优先级"
          value={filters.priority ?? ""}
          disabled={!enabled("filter:priority")}
          appearance="menu"
          onChange={(next) =>
            update({
              priority: next === "" ? null : (next as MyTaskPriority),
            })
          }
          options={[
            { value: "", label: "全部" },
            ...priorityOrder.map((priority) => ({
              value: priority,
              label: priorityLabels[priority],
              dotColor: priorityDotColor(priority),
            })),
          ]}
        />
        <CalmSelect
          ariaLabel="任务范围"
          value={filters.level ?? ""}
          appearance="notion"
          onChange={(next) =>
            update({
              level: next === "" ? null : (next as MyTaskLevel),
            })
          }
          options={[
            { value: "", label: "功能级与模块级" },
            { value: "FEATURE", label: "功能级任务", emoji: "\u{1F3AF}" },
            { value: "MODULE", label: "模块级任务", emoji: "\u{1F9E9}" },
          ]}
        />
        <button
          type="button"
          className="secondary-button"
          aria-expanded={advancedOpen}
          onClick={onToggleAdvanced}
        >
          <InpulseIcon name="sliders" size={15} />
          更多筛选{activeFilterCount > 0 ? " · " + activeFilterCount : ""}
        </button>
        <CalmSegmented
          label="展示方式"
          value={filters.display}
          options={displayOptions}
          onChange={(display) => update({ display })}
        />
      </div>

      {localGaps.length > 0 ? (
        <p className="view-description" data-testid="task-center-local-note">
          {localFilterNote(localGaps, items.length)}
        </p>
      ) : null}

      {advancedOpen ? (
        <div className="filter-panel">
          <label>
            合并关系
            <CalmSelect
              ariaLabel="合并关系"
              value={filters.relation ?? ""}
              disabled={!enabled("filter:relation")}
              appearance="menu"
              onChange={(next) =>
                update({
                  relation: next === "" ? null : (next as MyTaskRelation),
                })
              }
              options={[
                { value: "", label: "全部" },
                { value: "STANDALONE", label: "独立任务" },
                { value: "MAIN", label: "主任务" },
                { value: "SOURCE", label: "来源任务" },
              ]}
            />
          </label>
          <label>
            是否有迭代记录
            <CalmSelect
              ariaLabel="是否有迭代记录"
              value={filters.hasRecord ?? ""}
              appearance="menu"
              onChange={(next) =>
                update({
                  hasRecord: next === "" ? null : (next as MyTaskRecordFilter),
                })
              }
              options={[
                { value: "", label: "全部" },
                { value: "yes", label: "有记录" },
                { value: "no", label: "无记录" },
              ]}
            />
          </label>
          <label>
            是否有 GitHub
            <CalmSelect
              ariaLabel="是否有 GitHub"
              value={filters.hasGithub ?? ""}
              disabled={!enabled("filter:github")}
              appearance="menu"
              onChange={(next) =>
                update({
                  hasGithub: next === "" ? null : (next as MyTaskGithubFilter),
                })
              }
              options={[
                { value: "", label: "全部" },
                { value: "yes", label: "已关联" },
                { value: "no", label: "未关联" },
              ]}
            />
          </label>
          <label className="check-line">
            <input
              type="checkbox"
              checked={filters.includeCanceled}
              disabled={!enabled("filter:canceled-with-open")}
              onChange={(event) =>
                update({ includeCanceled: event.target.checked })
              }
            />
            显示已取消任务（不计入完成率）
          </label>
          <button
            type="button"
            className="text-button"
            onClick={() => onFiltersChange(DEFAULT_MY_TASK_FILTERS)}
          >
            重置筛选
          </button>
        </div>
      ) : null}

      {filters.scope === "project" && filters.projectId === null ? (
        <CalmEmptyState
          icon="folder"
          title="请选择项目"
          description="选择项目后查看该项目内全员的任务。"
        />
      ) : taskQuery.isPending ? (
        <div className="calm-state">
          <Spin size="large" />
          <p>正在加载任务列表…</p>
        </div>
      ) : taskQuery.isError ? (
        <Alert type="error" title={describeMyTasksError(taskQuery.error)} />
      ) : (
        <>
          <CalmSectionTitle
            title={listTitle}
            hint={
              primaryItems.length +
              " 项 · " +
              (activeAdapter.source === "mock"
                ? "按逾期、今天截止、优先级排序"
                : "服务端按任务编号倒序")
            }
          >
            <InpulseIcon
              name={filters.display === "cards" ? "layoutGrid" : "list"}
              size={16}
            />
          </CalmSectionTitle>
          {primaryItems.length > 0 ? (
            filters.display === "cards" ? (
              <div className="calm-task-grid">
                {primaryItems.map(renderCard)}
              </div>
            ) : (
              renderTable(primaryItems)
            )
          ) : (
            <CalmEmptyState
              icon="check"
              title={listEmptyTitle}
              description={listEmptyDescription}
            />
          )}
          {filters.status === "open" && doneItems.length > 0 ? (
            <details
              className="calm-disclosure history-block"
              open={openItems.length === 0}
            >
              <summary>
                已完成 {doneItems.length} 项 · 保留编号、负责人与全部迭代记录
              </summary>
              {renderTable(doneItems)}
            </details>
          ) : null}
          {filters.status !== "all" && canceledItems.length > 0 ? (
            <details className="calm-disclosure history-block">
              <summary>
                已取消 {canceledItems.length} 项 · 默认折叠，不计入完成率
              </summary>
              {renderTable(canceledItems)}
            </details>
          ) : null}
        </>
      )}

      {taskQuery.hasNextPage && (
        <Button
          loading={taskQuery.isFetchingNextPage}
          onClick={() => void taskQuery.fetchNextPage()}
        >
          加载更多任务
        </Button>
      )}

      <section className="group-panel" aria-label="任务聚合组">
        <CalmSectionTitle
          title="任务聚合组"
          hint="合并后主任务是统一入口，来源任务作为独立分支保留全部历史"
        >
          <CalmBadge tone="violet">{groups.length} 个聚合组</CalmBadge>
        </CalmSectionTitle>
        {groupsQuery.isPending ? (
          <div className="calm-state">
            <Spin size="large" />
            <p>正在加载聚合组…</p>
          </div>
        ) : groupsQuery.isError ? (
          <Alert type="error" title={describeMyTasksError(groupsQuery.error)} />
        ) : groups.length === 0 ? (
          <CalmEmptyState
            icon="gitMerge"
            title="还没有聚合组"
            description="发现重复任务时，可在任务详情中合并到主任务。"
          />
        ) : (
          <>
            <div className="group-list">
              {groups.map((group) => {
                const mainTask = group.mainTask;
                return (
                  <article className="group-card" key={group.groupId}>
                    <header>
                      <span className="task-id">{group.code}</span>
                      <button
                        type="button"
                        className="group-card-title"
                        aria-haspopup="dialog"
                        onClick={() => setOpenGroupId(group.groupId)}
                      >
                        <strong>{group.name}</strong>
                      </button>
                      <CalmBadge
                        tone={group.status === "ACTIVE" ? "blue" : "gray"}
                      >
                        {group.status === "ACTIVE" ? "进行中" : "已关闭"}
                      </CalmBadge>
                      <small>
                        {projectNames.get(group.projectId) ?? group.projectName}
                      </small>
                    </header>
                    <ul>
                      {group.branches.map((branch) => (
                        <li key={branch.taskId}>
                          <CalmBadge
                            tone={branch.role === "MAIN" ? "violet" : "cyan"}
                          >
                            {branch.role === "MAIN"
                              ? "主分支"
                              : sourceKindLabel(branch.sourceKind)}
                          </CalmBadge>
                          <button
                            type="button"
                            className="branch-task"
                            onClick={() =>
                              onOpenTask?.({
                                projectId: group.projectId,
                                moduleId: branch.moduleId,
                                featureId: branch.featureId,
                                taskId: branch.taskId,
                              })
                            }
                          >
                            <span className="branch-task-code">
                              {branch.taskCode}
                            </span>
                            <strong>{branch.title}</strong>
                          </button>
                          <CalmBadge tone={statusTone[branch.workStatus]}>
                            {statusLabels[branch.workStatus]}
                          </CalmBadge>
                          <small>{branch.assignee.name}</small>
                        </li>
                      ))}
                    </ul>
                    <footer>
                      <InpulseIcon name="gitMerge" size={14} />
                      <span>
                        来源任务的原始状态、负责人、迭代记录与 GitHub
                        链接全部保留。
                      </span>
                      <button
                        type="button"
                        className="group-card-open"
                        aria-haspopup="dialog"
                        onClick={() => setOpenGroupId(group.groupId)}
                      >
                        {group.status === "ACTIVE"
                          ? "查看详情 / 解除合并"
                          : "查看聚合历史"}
                      </button>
                      {mainTask === null ? null : (
                        <button
                          type="button"
                          className="text-button"
                          onClick={() =>
                            onOpenTask?.({
                              projectId: mainTask.projectId,
                              moduleId: mainTask.moduleId,
                              featureId: mainTask.featureId,
                              taskId: mainTask.taskId,
                            })
                          }
                        >
                          查看主任务
                          <InpulseIcon name="chevronRight" size={14} />
                        </button>
                      )}
                    </footer>
                  </article>
                );
              })}
            </div>
            {groupsQuery.hasNextPage ? (
              <div className="group-panel-load-more">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={groupsQuery.isFetchingNextPage}
                  onClick={() => void groupsQuery.fetchNextPage()}
                >
                  {groupsQuery.isFetchingNextPage ? "正在加载…" : "加载更多"}
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>

      <TaskGroupDetailModal
        groupId={openGroupId}
        adapter={groupAdapter}
        api={api}
        onClose={() => setOpenGroupId(null)}
        onChanged={() => void groupsQuery.refetch()}
        onOpenTask={onOpenTask}
      />

      <GlobalTaskCreateModal
        onCreatedLocation={onOpenTask}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        client={client}
        preset={
          filters.scope === "project" && filters.projectId !== null
            ? { projectId: filters.projectId }
            : undefined
        }
      />
    </section>
  );
};

export default TaskCenterPageView;
