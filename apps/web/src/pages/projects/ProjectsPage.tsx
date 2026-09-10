import React, { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { CreateProjectResponse, InpulseApiClient } from "@generated/api";
import { useAuth } from "@features/auth/auth-context";
import {
  describeProjectListError,
  useProjects,
} from "@features/projects/project-query";
import { ProjectsPageView } from "@features/projects/ProjectsPageView";

export interface ProjectsPageProps {
  readonly client?: InpulseApiClient;
}

export const ProjectsPage: React.FC<ProjectsPageProps> = ({ client }) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [createdProject, setCreatedProject] =
    useState<CreateProjectResponse | null>(null);
  const projectList = useProjects({ client });

  const handleCreated = useCallback((response: CreateProjectResponse) => {
    setCreatedProject(response);
  }, []);

  const handleOpenActivity = useCallback(
    (projectId: number) => {
      navigate(`/projects/${projectId}/activity`);
    },
    [navigate],
  );

  const handleSearch = useCallback(
    (query: string) => {
      navigate(`/search?q=${encodeURIComponent(query)}`);
    },
    [navigate],
  );

  return (
    <ProjectsPageView
      creatorName={user?.name.trim() || "创建者"}
      creatorUserId={user?.id}
      isAdmin={user?.isAdmin === true}
      createdProject={createdProject}
      onCreated={handleCreated}
      onBackToTasks={() => navigate("/tasks")}
      onOpenActivity={handleOpenActivity}
      onOpenModules={(projectId) => navigate(`/projects/${projectId}/modules`)}
      onOpenMembers={(projectId) => navigate(`/projects/${projectId}/members`)}
      onSearch={handleSearch}
      projects={projectList.data?.items ?? []}
      projectsLoading={projectList.isPending}
      projectsError={
        projectList.isError
          ? describeProjectListError(projectList.error)
          : undefined
      }
      onRetryProjects={() => void projectList.refetch()}
      {...(client ? { client } : {})}
    />
  );
};

export default ProjectsPage;
