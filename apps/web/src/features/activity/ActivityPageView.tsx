import React from "react";
import type { InpulseApiClient } from "@generated/api";
import { ActivityWorkspace } from "./ActivityWorkspace";

export interface ActivityPageViewProps {
  /** 传项目 ID 表示项目详情页的动态；不传表示跨项目聚合的动态中心。 */
  readonly projectId?: number | undefined;
  readonly client?: InpulseApiClient | undefined;
}

export const ActivityPageView: React.FC<ActivityPageViewProps> = ({
  projectId,
  client,
}) => {
  return (
    <ActivityWorkspace
      {...(projectId === undefined ? {} : { lockedProjectId: projectId })}
      {...(client ? { client } : {})}
    />
  );
};

export default ActivityPageView;
