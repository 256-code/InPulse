import React from "react";
import { WorkspacePlaceholder } from "@features/common/components/WorkspacePlaceholder";

export const IssuesPage: React.FC = () => {
  return (
    <WorkspacePlaceholder
      title="遗留问题"
      description="待闭环的后续工作将在遗留项查询接口就绪后接入。"
    />
  );
};

export default IssuesPage;
