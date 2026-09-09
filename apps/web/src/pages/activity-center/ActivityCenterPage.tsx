import React, { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { InpulseApiClient } from "@generated/api";
import { ActivityIndexPageView } from "@features/activity-center/ActivityIndexPageView";

export interface ActivityCenterPageProps {
  readonly client?: InpulseApiClient;
}

export const ActivityCenterPage: React.FC<ActivityCenterPageProps> = ({
  client,
}) => {
  const navigate = useNavigate();
  const handleOpenProject = useCallback(
    (projectId: number) => {
      navigate(`/projects/${projectId}/activity`);
    },
    [navigate],
  );

  return (
    <ActivityIndexPageView
      onOpenProject={handleOpenProject}
      {...(client ? { client } : {})}
    />
  );
};

export default ActivityCenterPage;
