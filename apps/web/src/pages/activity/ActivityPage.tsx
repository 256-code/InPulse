import React from "react";
import { Result } from "antd";
import { useParams } from "react-router-dom";
import type { InpulseApiClient } from "@generated/api";
import { ActivityPageView } from "@features/activity/ActivityPageView";

export interface ActivityPageProps {
  readonly client?: InpulseApiClient;
}

function parseProjectId(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export const ActivityPage: React.FC<ActivityPageProps> = ({ client }) => {
  const { projectId: projectIdParam } = useParams<{ projectId: string }>();
  const projectId = parseProjectId(projectIdParam);

  if (projectId === null) {
    return (
      <Result
        status="404"
        title="项目不存在"
        subTitle="项目 ID 格式无效或项目不可访问。"
      />
    );
  }

  return (
    <ActivityPageView projectId={projectId} {...(client ? { client } : {})} />
  );
};

export default ActivityPage;
