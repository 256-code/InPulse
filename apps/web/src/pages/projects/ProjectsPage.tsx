import React from "react";
import { WorkspacePlaceholder } from "@features/common/components/WorkspacePlaceholder";

export const ProjectsPage: React.FC = () => {
  return (
    <WorkspacePlaceholder
      title="项目与功能"
      description="项目、模块、功能和任务的入口将在项目查询接口就绪后接入。"
    />
  );
};

export default ProjectsPage;
