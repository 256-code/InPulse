import React from "react";
import { WorkspacePlaceholder } from "@features/common/components/WorkspacePlaceholder";

export const SettingsPage: React.FC = () => {
  return (
    <WorkspacePlaceholder
      eyebrow="系统 / 成员与权限"
      title="成员与设置"
      description="成员、角色、项目归属与权限边界；成员管理接口就绪后接入。"
      icon="settings"
    />
  );
};

export default SettingsPage;
