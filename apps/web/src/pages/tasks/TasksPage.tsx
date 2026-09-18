import React, { lazy, Suspense, useCallback, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { InpulseApiClient } from "@generated/api";
import { useAuth } from "@features/auth/auth-context";
import { useProjects } from "@features/projects/project-query";
import type {
  MyTaskFilters,
  MyTasksAdapter,
} from "@features/my-tasks/my-tasks-types";
import {
  readMyTaskAdvancedOpen,
  readMyTaskFilters,
  writeMyTaskFilters,
} from "@features/my-tasks/my-tasks-url";
import { createMyTasksServerAdapter } from "@features/my-tasks/my-tasks-server";
import type { TaskLocation } from "@features/tasks/task-links";
import { TaskCenterPageView } from "@features/my-tasks/TaskCenterPageView";

/**
 * 任务详情弹窗按需加载：任务中心的初始包不引入功能档案的完整任务面板，
 * 首次点击任务卡片时才加载详情弹窗与配套写入口。
 */
const TaskDetailOverlay = lazy(
  () => import("@features/tasks/TaskDetailOverlay"),
);

export interface TasksPageProps {
  readonly client?: InpulseApiClient;
  readonly adapter?: MyTasksAdapter;
}

export const TasksPage: React.FC<TasksPageProps> = ({ client, adapter }) => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [detailTarget, setDetailTarget] = useState<TaskLocation | null>(null);
  const { user } = useAuth();
  const projectList = useProjects({ client });

  const isAdmin = user?.isAdmin === true;
  const filters = useMemo(
    () => readMyTaskFilters(searchParams, { isAdmin }),
    [searchParams, isAdmin],
  );
  const advancedOpen = useMemo(
    () => readMyTaskAdvancedOpen(searchParams),
    [searchParams],
  );

  const handleFiltersChange = useCallback(
    (next: MyTaskFilters) => {
      setSearchParams(writeMyTaskFilters(next, { advancedOpen }), {
        replace: true,
      });
    },
    [advancedOpen, setSearchParams],
  );

  const handleToggleAdvanced = useCallback(() => {
    setSearchParams(
      writeMyTaskFilters(filters, { advancedOpen: !advancedOpen }),
      { replace: true },
    );
  }, [advancedOpen, filters, setSearchParams]);

  const handleOpenIssues = useCallback(() => {
    navigate("/issues");
  }, [navigate]);

  /**
   * 任务卡片 / 列表行与聚合组入口点击后在当前页面就地打开任务详情弹窗：与功能档案
   * 共用同一个完整详情（含状态推进、编辑、迭代记录等写操作），不改变地址栏、不跳转，
   * 关闭后仍停留在任务中心。
   */
  const handleOpenTask = useCallback((task: TaskLocation) => {
    setDetailTarget(task);
  }, []);

  const handleCloseTask = useCallback(() => {
    setDetailTarget(null);
  }, []);

  const taskAdapter = useMemo(
    () => adapter ?? createMyTasksServerAdapter(client),
    [adapter, client],
  );

  return (
    <>
      <TaskCenterPageView
        filters={filters}
        onFiltersChange={handleFiltersChange}
        viewerId={user?.id ?? null}
        isAdmin={isAdmin}
        projects={projectList.data?.items ?? []}
        advancedOpen={advancedOpen}
        onToggleAdvanced={handleToggleAdvanced}
        onOpenIssues={handleOpenIssues}
        onOpenTask={handleOpenTask}
        adapter={taskAdapter}
        client={client}
      />
      <Suspense fallback={null}>
        {detailTarget === null ? null : (
          <TaskDetailOverlay
            target={detailTarget}
            client={client}
            isAdmin={isAdmin}
            onClose={handleCloseTask}
            onOpenTask={handleOpenTask}
          />
        )}
      </Suspense>
    </>
  );
};

export default TasksPage;
