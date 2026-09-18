import { useState } from "react";
import { AppModal } from "@features/common/components/AppModal";
import { CalmBadge } from "@features/common/components/Calm";
import { InpulseIcon } from "@features/common/components/InpulseIcon";
import { ProjectLogo } from "@features/common/components/ProjectLogo";
import {
  projectLifecycleLabel,
  projectLifecycleTone,
} from "@features/common/resource-lifecycle";
import { useProjects } from "@features/projects/project-query";
import React from "react";
import { useNavigate } from "react-router-dom";
import type { InpulseApiClient } from "@generated/api";
import { useAuth } from "@features/auth/auth-context";
import { AdminUsersPageView } from "@features/users/AdminUsersPageView";

export interface SettingsPageProps {
  readonly client?: InpulseApiClient | undefined;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({ client }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [selectProject, setSelectProject] = useState(false);
  const projects = useProjects({ client, enabled: selectProject });
  return (
    <>
      <AdminUsersPageView
        currentUserId={user?.id}
        onOpenProjects={() => setSelectProject(true)}
        {...(client ? { client } : {})}
      />
      <AppModal
        open={selectProject}
        className="project-picker-modal"
        title="选择项目查看成员"
        onCancel={() => setSelectProject(false)}
        body
      >
        {projects.isPending ? (
          <p>正在加载项目</p>
        ) : projects.isError ? (
          <p role="alert">
            项目加载失败{" "}
            <button onClick={() => void projects.refetch()}>重试</button>
          </p>
        ) : projects.data?.items.length ? (
          <ul className="project-picker-list">
            {projects.data.items.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="project-picker-row"
                  onClick={() => navigate(`/projects/${p.id}/members`)}
                >
                  <ProjectLogo code={p.code} />
                  <span className="project-picker-meta">
                    <strong>{p.name}</strong>
                    <small>
                      {p.code} · {p.memberCount} 名成员
                    </small>
                  </span>
                  <CalmBadge tone={projectLifecycleTone(p.status, "blue")}>
                    {projectLifecycleLabel(p.status)}
                  </CalmBadge>
                  <InpulseIcon name="chevronRight" size={14} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p>暂无可访问的项目。</p>
        )}
      </AppModal>
    </>
  );
};

export default SettingsPage;
