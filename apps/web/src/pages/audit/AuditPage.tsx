import React from "react";
import { WorkspacePlaceholder } from "@features/common/components/WorkspacePlaceholder";

export const AuditPage: React.FC = () => {
  return (
    <WorkspacePlaceholder
      title="动态审计"
      description="项目动态和操作审计入口将在审计查询接口就绪后接入。"
    />
  );
};

export default AuditPage;
