import React, { lazy, Suspense, useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { InpulseApiClient } from "@generated/api";
import { useAuth } from "@features/auth/auth-context";
import { IssuesPageView } from "@features/issues/IssuesPageView";
import type { TaskLocation } from "@features/tasks/task-links";

/**
 * 任务详情弹窗按需加载：与任务中心 / 项目主页共用同一就地宿主，
 * 点击来源或跟进任务不再整页跳转到功能档案。
 */
const TaskDetailOverlay = lazy(
  () => import("@features/tasks/TaskDetailOverlay"),
);

/**
 * F-20 遗留问题页容器：回到迭代记录仍走路由跳转；来源 / 跟进任务改为在当前
 * 页面就地打开详情弹窗（与任务中心一致，不改变地址栏）。数据与状态全部在
 * IssuesPageView 内，经生成客户端访问 R-6。
 */

export interface IssuesPageProps {
  readonly client?: InpulseApiClient;
}

export const IssuesPage: React.FC<IssuesPageProps> = ({ client }) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [detailTarget, setDetailTarget] = useState<TaskLocation | null>(null);

  const handleBackToRecords = useCallback(() => {
    navigate("/records");
  }, [navigate]);

  const handleOpenTask = useCallback((task: TaskLocation) => {
    setDetailTarget(task);
  }, []);

  const handleCloseTask = useCallback(() => {
    setDetailTarget(null);
  }, []);

  return (
    <>
      <IssuesPageView
        onBackToRecords={handleBackToRecords}
        onOpenTask={handleOpenTask}
        {...(client ? { client } : {})}
      />
      <Suspense fallback={null}>
        {detailTarget === null ? null : (
          <TaskDetailOverlay
            target={detailTarget}
            client={client}
            isAdmin={user?.isAdmin === true}
            onClose={handleCloseTask}
            onOpenTask={handleOpenTask}
          />
        )}
      </Suspense>
    </>
  );
};

export default IssuesPage;
