import React from "react";
import { WorkspacePlaceholder } from "@features/common/components/WorkspacePlaceholder";

export const RecordsPage: React.FC = () => {
  return (
    <WorkspacePlaceholder
      eyebrow="工作区 / 迭代记录"
      title="迭代记录"
      description="只记录已发生或已确认的变化；人员、时间、归属与版本以服务端为准，记录接口就绪后接入。"
      icon="gitBranch"
    />
  );
};

export default RecordsPage;
