import React from "react";
import { Alert, Spin } from "antd";
import type { ProjectItem } from "@generated/api";
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
import { MY_TASKS_MOCK_ADAPTER } from "./my-tasks-mock";
import { describeMyTasksError, useMyTasksQuery } from "./my-tasks-query";
import {
  countActiveMyTaskFilters,
  DEFAULT_MY_TASK_FILTERS,
} from "./my-tasks-url";
import { formatDayIso, isBeforeTodayIso, isTodayIso } from "./my-tasks-time";
import type {
  MyTaskFilters,
  MyTaskGithubFilter,
  MyTaskLevel,
  MyTaskListItem,
  MyTaskPriority,
  MyTaskRecordFilter,
  MyTaskRelation,
  MyTaskScope,
  MyTasksAdapter,
  MyTaskWorkStatus,
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

const scopeHints: Record<MyTaskScope, string> = {
  mine: "我负责的任务；项目成员平权，任何人都可以推进与更新。",
  created: "我创建的任务；即使指派给他人，也会在这里跟踪。",
  project: "按项目查看全部任务，先选项目再看范围。",
  all: "管理员视图：查看全部项目的任务。",
};

const levelLabels: Record<MyTaskLevel, string> = {
  FEATURE: "功能级",
  MODULE: "模块级",
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

const displayOptions = [
  { value: "cards" as const, label: "卡片" },
  { value: "list" as const, label: "列表" },
];

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
    item.dueAt !== null &&
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
  readonly adapter?: MyTasksAdapter;
}

/**
 * F-32 任务中心页面视图。骨架阶段数据来自 mock adapter；
 * 项目名等公共字段来自 A 的 listProjects 端口（在页面层注入）。
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
  adapter,
}) => {
  const activeAdapter = adapter ?? MY_TASKS_MOCK_ADAPTER;
  const taskQuery = useMyTasksQuery({
    filters,
    viewerId,
    adapter: activeAdapter,
  });
  const result = taskQuery.data;
  const items = result?.items ?? [];
  const stats = result?.stats ?? {
    myOpen: 0,
    dueToday: 0,
    overdue: 0,
    completedThisMonth: 0,
  };
  const scopeCounts = result?.scopeCounts ?? {
    mine: 0,
    created: 0,
    project: 0,
    all: 0,
  };
  const leftoverCount = result?.leftoverCount ?? 0;
  const leftoverSample = result?.leftoverSample ?? null;
  const projectNames = new Map<number, string>(
    projects.map((project) => [project.id, project.name]),
  );
  const projectNameOf = (item: MyTaskListItem): string =>
    projectNames.get(item.projectId) ?? item.projectName;
  const openItems = items.filter((item) => item.workStatus === "TODO");
  const doneItems = items.filter((item) => item.workStatus === "DONE");
  const canceledItems = items.filter((item) => item.workStatus === "CANCELED");
  const overdueItem = openItems.find((item) => isOverdue(item)) ?? null;
  const activeFilterCount = countActiveMyTaskFilters(filters);

  const update = (patch: Partial<MyTaskFilters>) => {
    onFiltersChange({ ...filters, ...patch });
  };

  const handleScopeChange = (scope: MyTaskScope) => {
    if (scope === "project") {
      update({
        scope,
        projectId: filters.projectId ?? projects[0]?.id ?? null,
      });
      return;
    }
    update({ scope });
  };

  const statCards: ReadonlyArray<{
    readonly key: string;
    readonly label: string;
    readonly value: number;
    readonly hint: string;
    readonly icon: InpulseIconName;
    readonly tone: string;
    readonly onSelect: () => void;
  }> = [
    {
      key: "my-open",
      label: "我负责的未完成",
      value: stats.myOpen,
      hint: "点击切换到我的未完成任务",
      icon: "clipboard",
      tone: "blue",
      onSelect: () => update({ scope: "mine", status: "open" }),
    },
    {
      key: "due-today",
      label: "今天截止",
      value: stats.dueToday,
      hint: stats.dueToday > 0 ? "优先安排今天的工作" : "今天没有到期任务",
      icon: "calendar",
      tone: "violet",
      onSelect: () => update({ scope: "mine", status: "open", query: "" }),
    },
    {
      key: "overdue",
      label: "已逾期",
      value: stats.overdue,
      hint: stats.overdue > 0 ? "需要协调依赖或改期" : "没有逾期任务",
      icon: "alert",
      tone: stats.overdue > 0 ? "red" : "green",
      onSelect: () => update({ scope: "mine", status: "open" }),
    },
    {
      key: "completed",
      label: "本月完成",
      value: stats.completedThisMonth,
      hint: "已完成任务不会消失",
      icon: "check",
      tone: "green",
      onSelect: () => update({ scope: "mine", status: "done" }),
    },
  ];

  const renderCard = (item: MyTaskListItem) => (
    <article
      className="calm-task-card"
      key={item.taskId}
      data-testid={"my-task-" + item.taskId}
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
        <span title={"截止：" + dueLabel(item)}>
          <InpulseIcon name="clock" size={14} />
          {dueLabel(item)}
        </span>
      </div>
      <div className="task-card-footer">
        <CalmBadge tone={priorityTone[item.priority]}>
          {priorityLabels[item.priority]}优先级
        </CalmBadge>
        {item.hasPublishedRecord ? (
          <span className="task-card-counts">
            <span title="1 条已发布迭代记录">
              <InpulseIcon name="calendar" size={13} />
              记录 1 条
            </span>
          </span>
        ) : null}
      </div>
    </article>
  );

  const renderTable = (rows: readonly MyTaskListItem[]) => (
    <div className="feature-list-scroll">
      <table className="feature-list-table">
        <caption className="sr-only">跨项目任务列表</caption>
        <thead>
          <tr>
            <th scope="col">范围</th>
            <th scope="col">编号</th>
            <th scope="col">任务</th>
            <th scope="col">项目</th>
            <th scope="col">负责人</th>
            <th scope="col">优先级</th>
            <th scope="col">截止</th>
            <th scope="col">状态</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => (
            <tr key={item.taskId}>
              <td>
                <span className="task-scope">
                  {levelLabels[item.scopeType] + "任务"}
                </span>
              </td>
              <td>
                <span className="task-id">{item.code}</span>
              </td>
              <td>
                <strong className="task-table-title">{item.title}</strong>
                <span className="task-table-sub">
                  {item.moduleName +
                    (item.featureName === null ? "" : " / " + item.featureName)}
                </span>
              </td>
              <td>{projectNameOf(item)}</td>
              <td>{item.assignee.name}</td>
              <td>
                <CalmBadge tone={priorityTone[item.priority]}>
                  {priorityLabels[item.priority]}
                </CalmBadge>
              </td>
              <td className={isOverdue(item) ? "due-overdue" : undefined}>
                {dueLabel(item)}
              </td>
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
          <div className="eyebrow">任务中心 / {openItems.length} 项未完成</div>
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
            遗留问题{leftoverCount > 0 ? " " + leftoverCount : ""}
          </button>
          <button
            type="button"
            className="primary-button"
            disabled
            title="跨项目新建任务需要先确定任务归属，接口冻结后接入"
          >
            <InpulseIcon name="plus" size={16} />
            新建任务
          </button>
        </div>
      </div>

      <div className="skeleton-note" data-testid="task-center-mock-notice">
        <InpulseIcon name="alert" size={16} />
        <span>
          <strong>骨架数据：</strong>
          {activeAdapter.notice}
        </span>
      </div>

      {stats.overdue > 0 || leftoverCount > 0 ? (
        <div className="risk-strip">
          {stats.overdue > 0 ? (
            <button
              type="button"
              className="risk-banner"
              onClick={() => update({ scope: "mine", status: "open" })}
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
                      dueLabel(overdueItem)}
                </small>
              </span>
              <span className="risk-action">
                处理
                <InpulseIcon name="chevronRight" size={16} />
              </span>
            </button>
          ) : null}
          {leftoverCount > 0 ? (
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

      <div className="task-view-tabs" role="tablist" aria-label="任务范围">
        {scopeOrder
          .filter((scope) => scope !== "all" || isAdmin)
          .map((scope) => (
            <button
              key={scope}
              type="button"
              role="tab"
              aria-selected={filters.scope === scope}
              className={filters.scope === scope ? "selected" : ""}
              onClick={() => handleScopeChange(scope)}
            >
              {scopeLabels[scope]}
              <span>{scopeCounts[scope]}</span>
              {scope === "all" ? <small>管理员</small> : null}
            </button>
          ))}
      </div>
      <p className="view-description">{scopeHints[filters.scope]}</p>

      {filters.scope === "project" ? (
        <label className="inline-picker">
          选择项目
          <select
            value={filters.projectId === null ? "" : String(filters.projectId)}
            onChange={(event) =>
              update({ projectId: Number(event.target.value) || null })
            }
          >
            <option value="">全部可访问项目</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className="toolbar task-toolbar">
        <div className="task-search">
          <InpulseIcon name="search" size={16} />
          <input
            value={filters.query}
            placeholder="搜索任务编号、标题、描述、归属或负责人"
            aria-label="搜索任务"
            onChange={(event) => update({ query: event.target.value })}
          />
        </div>
        <CalmSegmented
          label="工作状态"
          value={filters.status}
          options={statusOptions}
          onChange={(status) => update({ status })}
        />
        <select
          aria-label="优先级"
          value={filters.priority ?? ""}
          onChange={(event) =>
            update({
              priority:
                event.target.value === ""
                  ? null
                  : (event.target.value as MyTaskPriority),
            })
          }
        >
          <option value="">全部优先级</option>
          {priorityOrder.map((priority) => (
            <option key={priority} value={priority}>
              {priorityLabels[priority]}
            </option>
          ))}
        </select>
        <select
          aria-label="任务范围"
          value={filters.level ?? ""}
          onChange={(event) =>
            update({
              level:
                event.target.value === ""
                  ? null
                  : (event.target.value as MyTaskLevel),
            })
          }
        >
          <option value="">功能级与模块级</option>
          <option value="FEATURE">功能级任务</option>
          <option value="MODULE">模块级任务</option>
        </select>
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

      {advancedOpen ? (
        <div className="filter-panel">
          <label>
            合并关系
            <select
              value={filters.relation ?? ""}
              onChange={(event) =>
                update({
                  relation:
                    event.target.value === ""
                      ? null
                      : (event.target.value as MyTaskRelation),
                })
              }
            >
              <option value="">全部</option>
              <option value="STANDALONE">独立任务</option>
              <option value="MAIN">主任务</option>
              <option value="SOURCE">来源任务</option>
            </select>
          </label>
          <label>
            是否有迭代记录
            <select
              value={filters.hasRecord ?? ""}
              onChange={(event) =>
                update({
                  hasRecord:
                    event.target.value === ""
                      ? null
                      : (event.target.value as MyTaskRecordFilter),
                })
              }
            >
              <option value="">全部</option>
              <option value="yes">有记录</option>
              <option value="no">无记录</option>
            </select>
          </label>
          <label>
            是否有 GitHub
            <select
              value={filters.hasGithub ?? ""}
              onChange={(event) =>
                update({
                  hasGithub:
                    event.target.value === ""
                      ? null
                      : (event.target.value as MyTaskGithubFilter),
                })
              }
            >
              <option value="">全部</option>
              <option value="yes">已关联</option>
              <option value="no">未关联</option>
            </select>
          </label>
          <label className="check-line">
            <input
              type="checkbox"
              checked={filters.includeCanceled}
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

      {taskQuery.isPending ? (
        <div className="calm-state">
          <Spin size="large" />
          <p>正在加载任务列表…</p>
        </div>
      ) : taskQuery.isError ? (
        <Alert type="error" title={describeMyTasksError(taskQuery.error)} />
      ) : (
        <>
          <CalmSectionTitle
            title="未完成"
            hint={openItems.length + " 项 · 按逾期、今天截止、优先级排序"}
          >
            <InpulseIcon
              name={filters.display === "cards" ? "layoutGrid" : "list"}
              size={16}
            />
          </CalmSectionTitle>
          {openItems.length > 0 ? (
            filters.display === "cards" ? (
              <div className="calm-task-grid">{openItems.map(renderCard)}</div>
            ) : (
              renderTable(openItems)
            )
          ) : (
            <CalmEmptyState
              icon="check"
              title="没有匹配的未完成任务"
              description="调整筛选条件，或到对应功能页创建新任务。"
            />
          )}
          {doneItems.length > 0 ? (
            <details
              className="calm-disclosure history-block"
              open={filters.status === "done"}
            >
              <summary>
                已完成 {doneItems.length} 项 ·
                保留编号、负责人、完成时间与全部迭代记录
              </summary>
              {renderTable(doneItems)}
            </details>
          ) : null}
          {canceledItems.length > 0 ? (
            <details className="calm-disclosure history-block">
              <summary>
                已取消 {canceledItems.length} 项 · 默认折叠，不计入完成率
              </summary>
              {renderTable(canceledItems)}
            </details>
          ) : null}
        </>
      )}
    </section>
  );
};

export default TaskCenterPageView;
