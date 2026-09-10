import React, { useMemo } from "react";
import { Alert } from "antd";
import { useNavigate, useParams } from "react-router-dom";
import type { InpulseApiClient } from "@generated/api";
import {
  describeProjectListError,
  useProjectDetail,
} from "@features/projects/project-query";
import type { ProjectOverviewAdapter } from "@features/project-overview/project-overview-types";
import { createProjectOverviewServerAdapter } from "@features/project-overview/project-overview-server";
import { ProjectOverviewPageView } from "@features/project-overview/ProjectOverviewPageView";

export interface ProjectOverviewPageProps {
  readonly client?: InpulseApiClient;
  readonly adapter?: ProjectOverviewAdapter;
}

interface ProjectOverviewContainerProps extends ProjectOverviewPageProps {
  readonly projectId: number;
}

const ProjectOverviewContainer: React.FC<ProjectOverviewContainerProps> = ({
  projectId,
  client,
  adapter,
}) => {
  const navigate = useNavigate();
  const projectQuery = useProjectDetail({ client, projectId });
  const projectError = projectQuery.isError
    ? describeProjectListError(projectQuery.error)
    : undefined;
  const overviewAdapter = useMemo(
    () => adapter ?? createProjectOverviewServerAdapter(client),
    [adapter, client],
  );

  return (
    <ProjectOverviewPageView
      projectId={projectId}
      project={projectQuery.data ?? null}
      projectLoading={projectQuery.isPending}
      onRetryProject={() => void projectQuery.refetch()}
      onBackToProjects={() => navigate("/projects")}
      onOpenModules={() => navigate("/projects/" + projectId + "/modules")}
      onOpenMembers={() => navigate("/projects/" + projectId + "/members")}
      onOpenRecords={() =>
        navigate("/records?view=published&projectId=" + projectId)
      }
      onOpenIssues={() => navigate("/issues")}
      {...(projectError === undefined ? {} : { projectError })}
      adapter={overviewAdapter}
    />
  );
};

export const ProjectOverviewPage: React.FC<ProjectOverviewPageProps> = ({
  client,
  adapter,
}) => {
  const { projectId } = useParams();
  const id = Number(projectId);
  if (!Number.isInteger(id) || id < 1 || id > 2147483647) {
    return <Alert type="error" title="项目地址无效" />;
  }
  return (
    <ProjectOverviewContainer
      key={id}
      projectId={id}
      {...(client === undefined ? {} : { client })}
      {...(adapter === undefined ? {} : { adapter })}
    />
  );
};

export default ProjectOverviewPage;
