import { useAuth } from "@features/auth/auth-context";
import { ActiveProjectMembers } from "@features/projects/ActiveProjectMembers";
import React from "react";
import { Alert, Spin } from "antd";
import { useParams } from "react-router-dom";
import type { InpulseApiClient } from "@generated/api";
import {
  canManageProjectResources,
  useProjectDetail,
} from "@features/projects/project-query";
import { ProjectMembersPageView } from "@features/projects/ProjectMembersPageView";

export interface ProjectMembersPageProps {
  readonly client?: InpulseApiClient | undefined;
}

/**
 * ADR-039：成员管理入口对全体活跃成员开放（含组长）——非成员（`currentUserRole`
 * 为 null）使用活跃成员只读视图，其余进入管理视图。
 */
export const ProjectMembersPage: React.FC<ProjectMembersPageProps> = ({
  client,
}) => {
  const { user } = useAuth();
  const { projectId } = useParams();
  const id = Number(projectId);
  if (!Number.isInteger(id) || id < 1 || id > 2147483647) {
    return <Alert type="error" title="项目地址无效" />;
  }
  const isSystemAdmin = user?.isAdmin === true;
  const detail = useProjectDetail({ projectId: id, client });
  if (!isSystemAdmin && detail.isPending) {
    return (
      <div className="calm-state">
        <Spin size="small" />
        <span>正在确认项目内角色</span>
      </div>
    );
  }
  const canManage =
    isSystemAdmin ||
    canManageProjectResources(false, detail.data?.currentUserRole ?? null);
  if (!canManage)
    return (
      <ActiveProjectMembers
        projectId={id}
        projectDetail={detail.data?.project ?? null}
        client={client}
      />
    );
  return (
    <ProjectMembersPageView
      key={id}
      projectId={id}
      client={client}
      isSystemAdmin={isSystemAdmin}
    />
  );
};

export default ProjectMembersPage;
