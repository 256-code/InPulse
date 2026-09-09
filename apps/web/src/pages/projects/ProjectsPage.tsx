import React, { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { CreateProjectResponse, InpulseApiClient } from "@generated/api";
import { useAuth } from "@features/auth/auth-context";
import { ProjectsPageView } from "@features/projects/ProjectsPageView";

export interface ProjectsPageProps {
  readonly client?: InpulseApiClient;
}

export const ProjectsPage: React.FC<ProjectsPageProps> = ({ client }) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [createdProject, setCreatedProject] =
    useState<CreateProjectResponse | null>(null);

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
      createdProject={createdProject}
      onCreated={handleCreated}
      onOpenActivity={handleOpenActivity}
      onSearch={handleSearch}
      {...(client ? { client } : {})}
    />
  );
};

export default ProjectsPage;
