import React from "react";
import { WorkspacePlaceholder } from "@features/common/components/WorkspacePlaceholder";

export const TasksPage: React.FC = () => {
  return (
    <WorkspacePlaceholder
      eyebrow="工作区 / 任务中心"
      title="任务中心"
      description="跨项目任务列表、范围与状态筛选、任务详情将在任务中心查询接口就绪后接入。"
      icon="layoutGrid"
    />
  );
};

export default TasksPage;
