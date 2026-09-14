import React from "react";
import { Alert } from "antd";
import { useParams } from "react-router-dom";
import type { InpulseApiClient } from "@generated/api";
import { ProjectMembersPageView } from "@features/projects/ProjectMembersPageView";

export interface ProjectMembersPageProps {
  readonly client?: InpulseApiClient | undefined;
}

export const ProjectMembersPage: React.FC<ProjectMembersPageProps> = ({
  client,
}) => {
  const { projectId } = useParams();
  const id = Number(projectId);
  if (!Number.isInteger(id) || id < 1 || id > 2147483647) {
    return <Alert type="error" title="项目地址无效" />;
  }
  return <ProjectMembersPageView key={id} projectId={id} client={client} />;
};

export default ProjectMembersPage;
