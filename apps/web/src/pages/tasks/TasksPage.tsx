import React, { useCallback, useMemo } from "react";
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
import { taskDetailPath, type TaskLocation } from "@features/tasks/task-links";
import { TaskCenterPageView } from "@features/my-tasks/TaskCenterPageView";

export interface TasksPageProps {
  readonly client?: InpulseApiClient;
  readonly adapter?: MyTasksAdapter;
}

export const TasksPage: React.FC<TasksPageProps> = ({ client, adapter }) => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
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

  const handleOpenTask = useCallback(
    (task: TaskLocation) => {
      navigate(taskDetailPath(task));
    },
    [navigate],
  );

  const taskAdapter = useMemo(
    () => adapter ?? createMyTasksServerAdapter(client),
    [adapter, client],
  );

  return (
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
    />
  );
};

export default TasksPage;
