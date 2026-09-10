import { ExternalLinksPanel } from "@features/external-links/ExternalLinksPanel";
import React, { useState } from "react";
import { Button } from "antd";
import type {
  CreateProjectResponse,
  InpulseApiClient,
  ProjectItem,
} from "@generated/api";
import { CreateProjectModal } from "./CreateProjectModal";
import {
  ArchiveProjectModal,
  EditProjectModal,
  RestoreProjectModal,
} from "./ProjectManagementModals";
import { CalmBadge, CalmEmptyState } from "@features/common/components/Calm";
import { InpulseIcon } from "@features/common/components/InpulseIcon";

const chipTones = ["tone-teal", "tone-blue", "tone-amber", "tone-violet"];

const hierarchyNotes = [
  { label: "项目", text: "顶层业务容器，承载范围与成员。" },
  { label: "模块", text: "项目内的一级业务分类，不支持子模块。" },
  { label: "功能", text: "长期档案，保存当前说明与全部迭代历史。" },
  { label: "任务", text: "一次具体执行工作，功能级或模块级。" },
  { label: "迭代记录", text: "已经发生的变化，人员与时间自动生成。" },
  { label: "来源分支", text: "合并后保留的历史，不删除不覆盖。" },
];

function resolveChipTone(code: string): string {
  let sum = 0;
  for (const char of code) {
    sum = (sum + char.charCodeAt(0)) % 997;
  }
  return chipTones[sum % chipTones.length] ?? "tone-blue";
}

export interface ProjectsPageViewProps {
  readonly client?: InpulseApiClient | undefined;
  readonly creatorName: string;
  readonly creatorUserId?: number | undefined;
  readonly isAdmin?: boolean | undefined;
  readonly createdProject?: CreateProjectResponse | null;
  readonly onCreated?: (response: CreateProjectResponse) => void;
  readonly onBackToTasks?: (() => void) | undefined;
  readonly onOpenActivity?: ((projectId: number) => void) | undefined;
  readonly onOpenModules?: ((projectId: number) => void) | undefined;
  readonly onOpenMembers?: ((projectId: number) => void) | undefined;
  readonly onSearch?: ((query: string) => void) | undefined;
  readonly projects?: readonly ProjectItem[] | undefined;
  readonly projectsLoading?: boolean | undefined;
  readonly projectsError?: string | undefined;
  readonly onRetryProjects?: (() => void) | undefined;
}

export const ProjectsPageView: React.FC<ProjectsPageViewProps> = ({
  client,
  creatorName,
  creatorUserId,
  isAdmin = false,
  createdProject,
  onCreated,
  onBackToTasks,
  onOpenActivity,
  onOpenModules,
  onOpenMembers,
  onSearch,
  projects = [],
  projectsLoading = false,
  projectsError,
  onRetryProjects,
}) => {
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectItem | null>(null);
  const [archiving, setArchiving] = useState<ProjectItem | null>(null);
  const [restoring, setRestoring] = useState<ProjectItem | null>(null);
  const [managementSuccess, setManagementSuccess] = useState<string | null>(
    null,
  );
  const eyebrow =
    projectsLoading || projectsError
      ? "项目"
      : "项目 / " + projects.length + " 个";

  return (
    <>
      <div className="page-header">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h1>项目与功能</h1>
        </div>
        <div className="catalog-actions">
          {onBackToTasks ? (
            <Button className="secondary-button" onClick={onBackToTasks}>
              <InpulseIcon name="clipboard" size={15} />
              回到任务中心
            </Button>
          ) : null}
          <Button
            className="primary-button"
            data-testid="create-project-button"
            onClick={() => setCreateOpen(true)}
          >
            <InpulseIcon name="plus" size={15} />
            新建项目
          </Button>
        </div>
      </div>

      {createdProject ? (
        <div className="creation-success" data-testid="created-project-success">
          <div className="creation-success-icon">
            <InpulseIcon name="check" size={18} />
          </div>
          <div className="creation-success-body">
            <strong>项目创建成功</strong>
            <span>
              {createdProject.project.name}（{createdProject.project.code}） ·
              已生成未分类模块，活动、通知与搜索投影已在同一事务中写入。
            </span>
          </div>
          <div className="creation-success-actions">
            <Button
              className="text-button"
              onClick={() => onOpenModules?.(createdProject.project.id)}
            >
              管理模块
            </Button>
            {isAdmin && onOpenMembers ? (
              <Button
                className="text-button"
                onClick={() => onOpenMembers(createdProject.project.id)}
              >
                管理成员
              </Button>
            ) : null}
            <Button
              className="text-button"
              data-testid="open-created-project-activity"
              onClick={() => onOpenActivity?.(createdProject.project.id)}
            >
              查看项目动态
            </Button>
            <Button
              className="text-button"
              data-testid="search-created-project"
              onClick={() => onSearch?.(createdProject.project.code)}
            >
              搜索项目
            </Button>
          </div>
        </div>
      ) : null}

      {managementSuccess ? (
        <div
          className="creation-success"
          data-testid="project-management-success"
        >
          <div className="creation-success-icon">
            <InpulseIcon name="check" size={18} />
          </div>
          <div className="creation-success-body">
            <strong>{managementSuccess}</strong>
          </div>
        </div>
      ) : null}

      {projectsLoading ? (
        <div className="calm-state">
          <span className="calm-spinner" />
          <span>正在加载项目列表</span>
        </div>
      ) : projectsError ? (
        <CalmEmptyState
          icon="alert"
          title="项目列表加载失败"
          description={projectsError}
        >
          {onRetryProjects ? (
            <Button className="secondary-button" onClick={onRetryProjects}>
              重试
            </Button>
          ) : null}
        </CalmEmptyState>
      ) : projects.length === 0 ? (
        <CalmEmptyState
          icon="boxes"
          title="还没有项目"
          description="创建第一个项目后，模块、功能、任务与迭代记录都会沉淀在对应项目内。"
        >
          <Button
            className="primary-button"
            onClick={() => setCreateOpen(true)}
          >
            <InpulseIcon name="plus" size={15} />
            新建项目
          </Button>
        </CalmEmptyState>
      ) : (
        <>
          <div className="cards-grid calm-feature-grid project-grid">
            {[...projects].map((project) => (
              <article
                key={project.id}
                className={
                  "calm-feature-card project-card" +
                  (project.status === "ARCHIVED" ? " card-archived" : "")
                }
              >
                <div className="calm-card-top">
                  <span
                    className={"project-chip " + resolveChipTone(project.code)}
                  >
                    {project.code}
                  </span>
                  <CalmBadge
                    tone={project.status === "ACTIVE" ? "blue" : "amber"}
                  >
                    {project.status === "ACTIVE" ? "正常" : "已归档"}
                  </CalmBadge>
                </div>
                <h2>{project.name}</h2>
                <p>{project.description || "暂无项目描述"}</p>
                <div className="card-footer project-card-footer">
                  <span>
                    <InpulseIcon name="users" size={14} />
                    {project.memberCount} 位成员
                  </span>
                  <div className="project-card-actions">
                    <ExternalLinksPanel
                      targetType="PROJECT"
                      targetId={project.id}
                      client={client}
                    />
                    <Button
                      className="text-button"
                      data-testid={`edit-project-${project.id}`}
                      onClick={() => setEditing(project)}
                    >
                      编辑
                    </Button>
                    {isAdmin ? (
                      project.status === "ACTIVE" ? (
                        <Button
                          className="danger-button"
                          data-testid={`archive-project-${project.id}`}
                          onClick={() => setArchiving(project)}
                        >
                          归档
                        </Button>
                      ) : (
                        <Button
                          className="text-button"
                          data-testid={`restore-project-${project.id}`}
                          onClick={() => setRestoring(project)}
                        >
                          恢复
                        </Button>
                      )
                    ) : null}
                    {isAdmin && onOpenMembers ? (
                      <Button
                        className="text-button"
                        onClick={() => onOpenMembers(project.id)}
                      >
                        管理成员
                      </Button>
                    ) : null}
                    {onOpenModules ? (
                      <Button
                        className="text-button project-card-more"
                        onClick={() => onOpenModules(project.id)}
                      >
                        查看模块
                        <InpulseIcon name="chevron" size={13} />
                      </Button>
                    ) : null}
                  </div>
                </div>
              </article>
            ))}
          </div>
          <section className="hierarchy-section" aria-label="层级说明">
            <h3>层级说明</h3>
            <p>项目 / 模块 / 功能 / 任务 / 迭代记录</p>
            <ul className="hierarchy-grid">
              {hierarchyNotes.map((note) => (
                <li key={note.label}>
                  <strong>{note.label}</strong>
                  <span>{note.text}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      <CreateProjectModal
        open={createOpen}
        creatorName={creatorName}
        creatorUserId={creatorUserId}
        client={client}
        onClose={() => setCreateOpen(false)}
        onCreated={(response) => {
          onCreated?.(response);
        }}
      />
      {editing ? (
        <EditProjectModal
          open
          project={editing}
          client={client}
          onClose={() => setEditing(null)}
          onUpdated={(updated) => {
            setEditing(null);
            setManagementSuccess(
              `项目「${updated.name}」已更新，当前版本 ${updated.rowVersion}。`,
            );
          }}
        />
      ) : null}
      {archiving ? (
        <ArchiveProjectModal
          open
          project={archiving}
          client={client}
          onClose={() => setArchiving(null)}
          onArchived={(updated) => {
            setArchiving(null);
            setManagementSuccess(
              `项目「${updated.name}」已归档，历史仍可查看。`,
            );
          }}
        />
      ) : null}
      {restoring ? (
        <RestoreProjectModal
          open
          project={restoring}
          client={client}
          onClose={() => setRestoring(null)}
          onRestored={(updated) => {
            setRestoring(null);
            setManagementSuccess(`项目「${updated.name}」已恢复为正常状态。`);
          }}
        />
      ) : null}
    </>
  );
};
