import React from "react";
import { WorkspacePlaceholder } from "@features/common/components/WorkspacePlaceholder";

export const TasksPage: React.FC = () => {
  return (
    <WorkspacePlaceholder
      title="任务中心"
      description="跨项目任务列表、状态筛选和详情入口将在任务查询接口就绪后接入。"
    />
  );
};

export default TasksPage;
