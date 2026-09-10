import React, { useCallback, useMemo } from "react";
import { Alert } from "antd";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { createApiClient, type InpulseApiClient } from "@generated/api";
import type { TaskGroupAdapter } from "@features/task-groups/task-groups-types";
import { createTaskGroupServerAdapter } from "@features/task-groups/task-groups-server";
import { TaskGroupPageView } from "@features/task-groups/TaskGroupPageView";
import {
  readTaskGroupMemberTaskId,
  writeTaskGroupMemberTaskId,
} from "@features/task-groups/task-groups-url";

/**
 * F-25 聚合组详情页容器：路由参数 groupId 校验后注入默认 server adapter
 * （R-1 / R-4）；记录筛选（task=成员任务 id）由 URL 承载（F-30），
 * 页面不保留内部副本。adapter 与 client 均可注入供测试替换。
 */

export interface TaskGroupPageProps {
  readonly client?: InpulseApiClient;
  readonly adapter?: TaskGroupAdapter;
}

interface TaskGroupContainerProps extends TaskGroupPageProps {
  readonly groupId: number;
}

const TaskGroupContainer: React.FC<TaskGroupContainerProps> = ({
  groupId,
  client,
  adapter,
}) => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const api = useMemo(() => client ?? createApiClient(), [client]);
  const groupAdapter = useMemo(
    () => adapter ?? createTaskGroupServerAdapter(api),
    [adapter, api],
  );
  const memberTaskId = useMemo(
    () => readTaskGroupMemberTaskId(searchParams),
    [searchParams],
  );
  const handleMemberTaskIdChange = useCallback(
    (next: number | null) => {
      setSearchParams(writeTaskGroupMemberTaskId(searchParams, next), {
        replace: true,
      });
    },
    [searchParams, setSearchParams],
  );

  return (
    <TaskGroupPageView
      groupId={groupId}
      adapter={groupAdapter}
      api={api}
      memberTaskId={memberTaskId}
      onMemberTaskIdChange={handleMemberTaskIdChange}
      onBackToTasks={() => navigate("/tasks")}
    />
  );
};

export const TaskGroupPage: React.FC<TaskGroupPageProps> = ({
  client,
  adapter,
}) => {
  const { groupId } = useParams();
  const id = Number(groupId);
  if (!Number.isInteger(id) || id < 1 || id > 2147483647) {
    return <Alert type="error" title="聚合组地址无效" />;
  }
  return (
    <TaskGroupContainer
      key={id}
      groupId={id}
      {...(client === undefined ? {} : { client })}
      {...(adapter === undefined ? {} : { adapter })}
    />
  );
};

export default TaskGroupPage;
