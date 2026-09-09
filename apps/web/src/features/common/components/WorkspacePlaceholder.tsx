import React from "react";
import { CalmBadge, CalmEmptyState } from "./Calm";
import type { InpulseIconName } from "./InpulseIcon";

export interface WorkspacePlaceholderProps {
  readonly title: string;
  readonly description: string;
  readonly status?: string;
  readonly icon?: InpulseIconName;
  readonly eyebrow?: string;
}

export const WorkspacePlaceholder: React.FC<WorkspacePlaceholderProps> = ({
  title,
  description,
  status = "待接入",
  icon = "boxes",
  eyebrow = "工作区",
}) => {
  return (
    <div className="workspace-placeholder">
      <div className="page-header">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        <div className="catalog-actions">
          <CalmBadge tone="amber">{status}</CalmBadge>
        </div>
      </div>
      <CalmEmptyState
        icon={icon}
        title="页面已建立，能力尚未接入"
        description="接口、权限与契约就绪后，这里会展示对应的真实业务数据。"
      >
        <span className="placeholder-note">
          当前版本不会用设计稿中的模拟数据代替真实数据。
        </span>
      </CalmEmptyState>
    </div>
  );
};
