import React from "react";
import type { InpulseApiClient } from "@generated/api";
import { ActivityPageView } from "@features/activity/ActivityPageView";

export interface ActivityCenterPageProps {
  readonly client?: InpulseApiClient;
}

/** 侧栏「项目动态」入口：不锁定项目，直接聚合当前账号可见的全部项目。 */
export const ActivityCenterPage: React.FC<ActivityCenterPageProps> = ({
  client,
}) => {
  return <ActivityPageView {...(client ? { client } : {})} />;
};

export default ActivityCenterPage;
