import React from "react";
import { WorkspacePlaceholder } from "@features/common/components/WorkspacePlaceholder";

export const IssuesPage: React.FC = () => {
  return (
    <WorkspacePlaceholder
      eyebrow="工作区 / 遗留问题"
      title="遗留问题"
      description="迭代记录中写下的遗留事项会汇总到这里；遗留项查询接口就绪后接入。"
      icon="alert"
    />
  );
};

export default IssuesPage;
