import React from "react";
import { WorkspacePlaceholder } from "@features/common/components/WorkspacePlaceholder";

export const SettingsPage: React.FC = () => {
  return (
    <WorkspacePlaceholder
      title="成员与设置"
      description="成员、角色和项目权限入口将在成员管理接口就绪后接入。"
    />
  );
};

export default SettingsPage;
