import React, { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { InpulseApiClient } from "@generated/api";
import { IssuesPageView } from "@features/issues/IssuesPageView";
import { taskDetailPath, type TaskLocation } from "@features/tasks/task-links";

/**
 * F-20 遗留问题页容器：只负责路由跳转（回到迭代记录、打开来源 / 跟进任务），
 * 数据与状态全部在 IssuesPageView 内，经生成客户端访问 R-5。
 */

export interface IssuesPageProps {
  readonly client?: InpulseApiClient;
}

export const IssuesPage: React.FC<IssuesPageProps> = ({ client }) => {
  const navigate = useNavigate();

  const handleBackToRecords = useCallback(() => {
    navigate("/records");
  }, [navigate]);

  const handleOpenTask = useCallback(
    (task: TaskLocation) => {
      navigate(taskDetailPath(task));
    },
    [navigate],
  );

  return (
    <IssuesPageView
      onBackToRecords={handleBackToRecords}
      onOpenTask={handleOpenTask}
      {...(client ? { client } : {})}
    />
  );
};

export default IssuesPage;
