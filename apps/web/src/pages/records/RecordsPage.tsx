import React from "react";
import { WorkspacePlaceholder } from "@features/common/components/WorkspacePlaceholder";

export const RecordsPage: React.FC = () => {
  return (
    <WorkspacePlaceholder
      title="迭代记录"
      description="迭代变化、版本和验证结果入口将在记录接口就绪后接入。"
    />
  );
};

export default RecordsPage;
