import React, { useMemo, useState } from "react";
import { Alert, Spin } from "antd";
import { createApiClient, type InpulseApiClient } from "@generated/api";
import { useAuth } from "@features/auth/auth-context";
import { InpulseIcon } from "@features/common/components/InpulseIcon";
import { GlobalTaskCreateModal } from "@features/tasks/GlobalTaskCreateModal";
import { TaskDetailOverlay } from "@features/tasks/TaskDetailOverlay";
import { useTaskMarks } from "@features/tasks/task-marks";
import type { TaskLocation } from "@features/tasks/task-links";

import { TaskBoardLanes } from "./components/TaskBoardLanes";
import { TaskBoardOverview } from "./components/TaskBoardOverview";
import { TaskBoardTable } from "./components/TaskBoardTable";
import { TaskBoardToolbar } from "./components/TaskBoardToolbar";
import {
  collectTaskBoardAssignees,
  countTaskBoardTasks,
  DEFAULT_TASK_BOARD_FILTERS,
  filterTaskBoardModules,
  hasActiveTaskBoardFilters,
} from "./task-board-filters";
import { formatTaskBoardDateTime } from "./task-board-format";
import { describeTaskBoardError, useTaskBoardQuery } from "./task-board-query";
import type {
  TaskBoardAdapter,
  TaskBoardCard,
  TaskBoardFilters,
} from "./task-board-types";

/**
 * R-8 项目任务看板页面视图（GET /api/v1/projects/{projectId}/task-board）。
 *
 * 数据来自注入的 adapter（页面默认注入 server 适配器）；顶部统计恒为项目全量
 * 口径，筛选只在本地过滤卡片并在图表区显示「筛选结果 N / 总数」；
 * 点击卡片就地打开任务详情弹窗（TaskDetailOverlay），不改变地址栏。
 */
export interface TaskBoardPageViewProps {
  readonly projectId: number;
  readonly filters: TaskBoardFilters;
  readonly onFiltersChange: (next: TaskBoardFilters) => void;
  readonly adapter: TaskBoardAdapter;
  readonly client?: InpulseApiClient | undefined;
  /** 空态引导：项目还没有任务时跳转模块与功能。 */
  readonly onOpenModules?: (() => void) | undefined;
}

export const TaskBoardPageView: React.FC<TaskBoardPageViewProps> = ({
  projectId,
  filters,
  onFiltersChange,
  adapter,
  client,
  onOpenModules,
}) => {
  const query = useTaskBoardQuery({ projectId, adapter });
  const { user } = useAuth();
  const [detailTarget, setDetailTarget] = useState<TaskLocation | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  // 折叠状态由看板与列表两种视图共享，且只存在于本次浏览：
  // 刷新或切走再回来恢复全展开，避免隐藏的任务被误认为不存在。
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<number>>(
    () => new Set(),
  );
  const toggleLane = (moduleId: number) => {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(moduleId)) {
        next.delete(moduleId);
      } else {
        next.add(moduleId);
      }
      return next;
    });
  };

  const data = query.data;
  const allModules = data?.modules ?? [];
  const visibleModules = useMemo(
    () => filterTaskBoardModules(allModules, filters),
    [allModules, filters],
  );
  const visibleCount = countTaskBoardTasks(visibleModules);
  const allCount = countTaskBoardTasks(allModules);
  const assignees = useMemo(
    () => collectTaskBoardAssignees(allModules),
    [allModules],
  );
  const filtered = hasActiveTaskBoardFilters(filters);
  // 裁决修订 D-2：遗留问题来源标记（hasLeftoverSource）不在看板契约里，
  // 按 R-5 页面级一次批量读取，读取失败时徽章按缺席隐藏。
  const api = useMemo(() => client ?? createApiClient(), [client]);
  const boardTaskIds = useMemo(
    () =>
      (data?.modules ?? []).flatMap((lane) =>
        lane.tasks.map((card) => card.taskId),
      ),
    [data],
  );
  const marks = useTaskMarks(api, boardTaskIds);
  const leftoverIds = useMemo(() => {
    const ids = new Set<number>();
    for (const [taskId, mark] of marks) {
      if (mark.hasLeftoverSource) ids.add(taskId);
    }
    return ids;
  }, [marks]);

  const openTask = (card: TaskBoardCard) => {
    setDetailTarget({
      projectId,
      moduleId: card.moduleId,
      featureId: card.featureId,
      taskId: card.taskId,
    });
  };

  const clearFilters = () => {
    onFiltersChange({ ...DEFAULT_TASK_BOARD_FILTERS, view: filters.view });
  };

  if (query.isPending) {
    return (
      <div className="tb-loading">
        <Spin size="large" description="正在加载任务看板..." />
      </div>
    );
  }
  if (query.isError || data === undefined) {
    return (
      <Alert
        type="error"
        title="任务看板暂时不可用"
        description={describeTaskBoardError(query.error)}
        showIcon
        action={<a onClick={() => void query.refetch()}>重试</a>}
      />
    );
  }

  return (
    <>
      <div className="tb-page-head">
        <h1>
          任务看板
          <span>
            {data.project.name} · 数据截至{" "}
            {formatTaskBoardDateTime(data.generatedAt)} · 完成率 = 已完成
            ÷（总任务 - 已取消）
          </span>
        </h1>
        <button
          type="button"
          className="primary-button"
          onClick={() => setCreateOpen(true)}
        >
          <InpulseIcon name="plus" size={13} />
          新建任务
        </button>
      </div>

      {data.truncated ? (
        <div className="tb-notice" role="status">
          <InpulseIcon name="alert" size={15} />
          任务超过 1000 条，列表按排序截断；顶部与泳道统计仍为项目全量口径。
        </div>
      ) : null}

      <TaskBoardOverview
        stats={data.stats}
        visibleCount={visibleCount}
        filtered={filtered}
        onClearFilters={clearFilters}
      />

      <TaskBoardToolbar
        filters={filters}
        counts={{
          all: data.stats.total,
          open: data.stats.open,
          done: data.stats.done,
          canceled: data.stats.canceled,
          overdue: data.stats.overdue,
          today: data.stats.dueToday,
        }}
        assignees={assignees}
        onChange={onFiltersChange}
      />

      {visibleModules.length === 0 ? (
        <div className="tb-empty">
          <p className="tb-empty-title">
            {allCount === 0 ? "项目还没有任务" : "没有匹配筛选条件的任务"}
          </p>
          <p className="tb-empty-sub">
            {allCount === 0
              ? "在模块与功能下创建第一个任务后，这里会按模块展示完成程度。"
              : "调整筛选条件，或清除筛选查看全部任务。"}
          </p>
          {allCount === 0 ? (
            onOpenModules ? (
              <button type="button" className="tb-link" onClick={onOpenModules}>
                前往模块与功能
              </button>
            ) : null
          ) : (
            <button type="button" className="tb-link" onClick={clearFilters}>
              清除筛选
            </button>
          )}
        </div>
      ) : filters.view === "board" ? (
        <TaskBoardLanes
          modules={visibleModules}
          collapsedIds={collapsedIds}
          leftoverIds={leftoverIds}
          onToggleLane={toggleLane}
          onOpenTask={openTask}
        />
      ) : (
        <TaskBoardTable
          modules={visibleModules}
          collapsedIds={collapsedIds}
          leftoverIds={leftoverIds}
          onToggleLane={toggleLane}
          onOpenTask={openTask}
        />
      )}

      <div className="tb-foot">
        <div className="tb-foot-legend">
          <span>
            <i className="tb-foot-dot tb-dot-todo" aria-hidden="true" />
            未完成
          </span>
          <span>
            <i className="tb-foot-dot tb-dot-overdue" aria-hidden="true" />
            已逾期
          </span>
          <span>
            <i className="tb-foot-dot tb-dot-done" aria-hidden="true" />
            已完成
          </span>
          <span>
            <i className="tb-foot-dot tb-dot-canceled" aria-hidden="true" />
            已取消
          </span>
        </div>
        <span>
          卡片顺序：逾期 → 未完成按优先级与截止 → 已完成 → 已取消 ·
          点击卡片查看任务详情
        </span>
      </div>

      {detailTarget === null ? null : (
        <TaskDetailOverlay
          target={detailTarget}
          client={client}
          isAdmin={user?.isAdmin === true}
          onClose={() => setDetailTarget(null)}
        />
      )}
      <GlobalTaskCreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        client={client}
        preset={{ projectId }}
        onCreatedLocation={(location) => {
          setCreateOpen(false);
          setDetailTarget(location);
        }}
      />
    </>
  );
};
