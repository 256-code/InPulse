import React from "react";
import type { InpulseApiClient } from "@generated/api";
import { useFeatures } from "@features/features/feature-query";
import { useModules } from "@features/modules/module-query";
import type { TaskLocation } from "./task-links";
import type { TaskScope } from "./task-query";
import { TasksPanel } from "./TasksPanel";

/**
 * 任务详情的就地宿主：任务中心等跨项目页点击任务后，在当前页面直接打开与功能
 * 档案一致的任务详情弹窗（状态推进、编辑、迭代记录、合并与外部链接等写入口
 * 全部由 TasksPanel 承担），不改变地址栏、不跳转到项目 / 模块 / 功能页。
 *
 * 可写性沿用功能档案的口径：父模块与父功能都必须处于 ACTIVE；状态数据未就绪
 * 时先按只读渲染，避免在未知状态下给出可写入口（服务端仍按实时权限独立校验）。
 */
export interface TaskDetailOverlayProps {
  readonly target: TaskLocation;
  readonly client?: InpulseApiClient | undefined;
  readonly isAdmin?: boolean | undefined;
  readonly onClose: () => void;
}

export const TaskDetailOverlay: React.FC<TaskDetailOverlayProps> = ({
  target,
  client,
  isAdmin,
  onClose,
}) => {
  const modules = useModules(target.projectId, client);
  const features = useFeatures(
    target.projectId,
    target.moduleId,
    undefined,
    client,
  );
  const moduleStatus = modules.query.data?.items.find(
    (item) => item.id === target.moduleId,
  )?.status;
  const featureStatus =
    target.featureId === null
      ? null
      : (features.query.data?.items.find((item) => item.id === target.featureId)
          ?.status ?? null);
  const writable =
    moduleStatus === "ACTIVE" &&
    (target.featureId === null || featureStatus === "ACTIVE");
  const scope: TaskScope = {
    projectId: target.projectId,
    moduleId: target.moduleId,
    featureId: target.featureId,
  };
  return (
    <TasksPanel
      key={target.taskId}
      {...scope}
      mode="detail"
      initialTaskId={target.taskId}
      writable={writable}
      isAdmin={isAdmin}
      client={client}
      onDetailClose={onClose}
    />
  );
};

export default TaskDetailOverlay;
