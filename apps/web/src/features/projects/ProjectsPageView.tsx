import React, { useState } from "react";
import { Button } from "antd";
import type {
  CreateProjectResponse,
  InpulseApiClient,
  ProjectItem,
  ProjectListItem,
} from "@generated/api";
import { CreateProjectModal } from "./CreateProjectModal";
import { EditProjectModal } from "./ProjectManagementModals";
import {
  CalmBadge,
  CalmEmptyState,
  CalmSectionTitle,
  CalmSegmented,
} from "@features/common/components/Calm";
import { isCardClick } from "@features/common/card-click";
import { canDeleteProject, canManageProjectResources } from "./project-query";
import { InpulseIcon } from "@features/common/components/InpulseIcon";
import { ProjectLogo } from "@features/common/components/ProjectLogo";
import {
  projectLifecycleLabel,
  projectLifecycleTone,
  projectTier,
  type ProjectTier,
} from "@features/common/resource-lifecycle";
import { CalmSkeleton } from "@features/common/components/CalmSkeleton";
import { useProjectTier } from "@features/common/project-tier-context";

const hierarchyNotes = [
  { label: "项目", text: "顶层业务容器，承载范围与成员。" },
  { label: "模块", text: "项目内的一级业务分类，不支持子模块。" },
  { label: "功能", text: "长期档案，保存当前说明与全部迭代历史。" },
  { label: "任务", text: "一次具体执行工作，功能级或模块级。" },
  { label: "迭代记录", text: "已经发生的变化，人员与时间自动生成。" },
  { label: "分支任务", text: "合并后保留的历史，不删除不覆盖。" },
];

export interface ProjectsPageViewProps {
  readonly client?: InpulseApiClient | undefined;
  readonly creatorName: string;
  readonly creatorUserId?: number | undefined;
  readonly isAdmin?: boolean | undefined;
  readonly createdProject?: CreateProjectResponse | null;
  /**
   * 打开「新建项目」表单前的清理钩子（2026-09-29 用户指示）：上一次创建成功的卡片
   * 一直挂在页面上，重新点「新建项目」时它仍显示旧项目名，属于「上次残留」，先清掉。
   */
  readonly onStartCreate?: (() => void) | undefined;
  readonly onCreated?: (response: CreateProjectResponse) => void;
  readonly onOpenActivity?: ((projectId: number) => void) | undefined;
  readonly onOpenModules?: ((projectId: number) => void) | undefined;
  readonly onOpenMembers?: ((projectId: number) => void) | undefined;
  readonly onSearch?: ((query: string) => void) | undefined;
  readonly projects?: readonly ProjectListItem[] | undefined;
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
  onStartCreate,
  onCreated,
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
  const [editingRole, setEditingRole] =
    useState<ProjectListItem["currentUserRole"]>(null);
  const [managementSuccess, setManagementSuccess] = useState<string | null>(
    null,
  );
  // 本地过滤（2026-09-30 用户指示）：只在项目列表页搜索当前列表，不走全局搜索。
  const [search, setSearch] = useState("");
  // 生命周期分档（2026-10-09 用户指示）：与任务中心「未完成 / 已完成」同形态的滑块，
  // 按项目自己的三态归并成两档——未完成（进行中 + 未开始）与维护中。
  // 档位由 AppLayout 的 ProjectTierProvider 持有，侧栏项目树读同一份状态，
  // 因此这里只负责渲染与切换，不再自己 useState。
  const { tier, selectTier } = useProjectTier();

  // 两档计数在关键词之前算：滑块上的数字是当前可见项目的总量，不随搜索词跳动。
  const maintenanceProjectCount = projects.filter(
    (project) => projectTier(project.status) === "maintenance",
  ).length;
  const tierOptions: ReadonlyArray<{
    readonly value: ProjectTier;
    readonly label: string;
    readonly count: number;
  }> = [
    {
      value: "open",
      label: "未完成",
      count: projects.length - maintenanceProjectCount,
    },
    { value: "maintenance", label: "维护中", count: maintenanceProjectCount },
  ];

  // 维护中这一档按「进入维护的时间」从近到远排，越久以前进入维护的排越后
  // （2026-10-09 用户指示）。项目列表契约里没有精确的「进入维护时间」字段，这里用
  // `updatedAt` 近似：切到维护中会写 `projects.updated_at`，此后只有再次编辑项目本身
  // （改名、改描述）才会把它推近，任务与成员的变化不写这一列。服务端 `list` 的默认
  // 顺序是「档位 + 最近变更时间（含任务动态）」，维护中一档会随任务动态漂移，所以本档
  // 在客户端重排；未完成一档保持服务端顺序（进行中 → 未开始，档内最近变更在前）。
  const tierProjects =
    tier === "maintenance"
      ? projects
          .filter((project) => projectTier(project.status) === "maintenance")
          .sort(
            (left, right) =>
              Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
              right.id - left.id,
          )
      : projects.filter((project) => projectTier(project.status) === "open");

  const keyword = search.trim().toLocaleLowerCase();
  const visibleProjects =
    keyword === ""
      ? tierProjects
      : tierProjects.filter(
          (project) =>
            project.name.toLocaleLowerCase().includes(keyword) ||
            project.code.toLocaleLowerCase().includes(keyword) ||
            (project.description ?? "").toLocaleLowerCase().includes(keyword),
        );

  return (
    <>
      <div className="page-header">
        <div className="catalog-heading">
          <h1>项目列表</h1>
          <p>项目负责承载范围，模块负责分类，功能负责沉淀。</p>
        </div>
        <div className="catalog-actions">
          {projects.length > 0 ? (
            <>
              {/* 生命周期滑块与搜索框同行，且在搜索框左侧（2026-10-09 用户指示）。 */}
              <CalmSegmented
                label="项目生命周期分档"
                value={tier}
                options={tierOptions}
                onChange={selectTier}
              />
              <div className="task-search">
                <InpulseIcon name="search" size={15} />
                <input
                  aria-label="搜索项目"
                  placeholder="搜索项目名称、编码或描述"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
            </>
          ) : null}
          <Button
            className="primary-button"
            data-testid="create-project-button"
            onClick={() => {
              onStartCreate?.();
              setCreateOpen(true);
            }}
          >
            <InpulseIcon name="plus" size={15} />
            新建项目
          </Button>
        </div>
      </div>

      {isAdmin ? (
        <p className="view-description">
          当前身份为系统管理员，可查看全部项目；项目成员只会看到已加入的项目。
        </p>
      ) : null}

      {createdProject ? (
        <div className="creation-success" data-testid="created-project-success">
          <div className="creation-success-icon">
            <InpulseIcon name="check" size={18} />
          </div>
          <div className="creation-success-body">
            <strong>项目创建成功</strong>
            <span>
              {createdProject.project.name}（{createdProject.project.code}） ·
              现在可以新增模块，或在新建任务时创建模块和功能。
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
        <CalmSkeleton variant="card" rows={3} label="正在加载项目列表" />
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
            onClick={() => {
              onStartCreate?.();
              setCreateOpen(true);
            }}
          >
            <InpulseIcon name="plus" size={15} />
            新建项目
          </Button>
        </CalmEmptyState>
      ) : (
        <>
          {visibleProjects.length === 0 ? (
            keyword === "" ? (
              <CalmEmptyState
                icon="boxes"
                title={
                  tier === "maintenance"
                    ? "没有维护中的项目"
                    : "没有未完成的项目"
                }
                description={
                  tier === "maintenance"
                    ? "项目主体完成并切到维护中后会归到这一档，按进入维护的时间从近到远排列。"
                    : "当前项目都已切到维护中，可以切到「维护中」这一档查看。"
                }
              />
            ) : (
              <CalmEmptyState
                icon="search"
                title="没有匹配的项目"
                description="调整关键词后重试，或清空搜索查看全部项目。"
              >
                <Button
                  className="secondary-button"
                  onClick={() => setSearch("")}
                >
                  清空搜索
                </Button>
              </CalmEmptyState>
            )
          ) : (
            <div className="cards-grid calm-projects">
              {[...visibleProjects].map((project) => (
                <article
                  key={project.id}
                  className={
                    project.status === "MAINTENANCE"
                      ? "project-card is-maintenance"
                      : "project-card"
                  }
                  onClick={(event) => {
                    if (!isCardClick(event)) return;
                    onOpenModules?.(project.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    if (event.target !== event.currentTarget) return;
                    event.preventDefault();
                    onOpenModules?.(project.id);
                  }}
                  tabIndex={0}
                >
                  <span className="card-top">
                    <ProjectLogo code={project.code} />
                    <CalmBadge
                      tone={projectLifecycleTone(project.status, "blue")}
                    >
                      {projectLifecycleLabel(project.status)}
                    </CalmBadge>
                  </span>
                  <h2>{project.name}</h2>
                  <p className="project-card-desc">{project.description}</p>
                  <span className="card-footer">
                    <span>
                      <InpulseIcon name="boxes" size={14} />
                      {project.stats.activeModuleCount} 个模块
                    </span>
                    <span>
                      <InpulseIcon name="code" size={14} />
                      {project.stats.activeFeatureCount} 个功能
                    </span>
                    <span>
                      <InpulseIcon name="clipboard" size={14} />
                      {project.stats.openTaskCount} 项待办
                    </span>
                  </span>
                  <span className="card-footer">
                    <span>
                      <InpulseIcon name="users" size={14} />
                      {project.memberCount} 位成员
                    </span>
                  </span>
                  <div className="card-footer project-card-actions">
                    <div className="project-card-actions-main">
                      <Button
                        className="text-button"
                        data-testid={`edit-project-${project.id}`}
                        onClick={() => {
                          setEditingRole(project.currentUserRole);
                          setEditing(project);
                        }}
                      >
                        编辑
                      </Button>
                    </div>
                    {isAdmin && onOpenMembers ? (
                      <Button
                        className="text-button"
                        onClick={() => onOpenMembers(project.id)}
                      >
                        管理成员
                      </Button>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          )}
          <CalmSectionTitle
            title="层级说明"
            hint="项目 / 模块 / 功能 / 任务 / 迭代记录"
          />
          <ul className="rule-list rule-list-grid">
            {hierarchyNotes.map((note) => (
              <li key={note.label}>
                <strong>{note.label}</strong>
                {note.text}
              </li>
            ))}
          </ul>
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
          canChangeStatus={canManageProjectResources(isAdmin, editingRole)}
          canDeleteProject={canDeleteProject(isAdmin, editingRole)}
          onClose={() => {
            setEditing(null);
            setEditingRole(null);
          }}
          onUpdated={(updated) => {
            setEditing(null);
            setEditingRole(null);
            setManagementSuccess(
              `项目「${updated.name}」已更新，当前版本 ${updated.rowVersion}。`,
            );
          }}
          onDeleted={() => {
            const name = editing.name;
            setEditing(null);
            setEditingRole(null);
            setManagementSuccess(
              `项目「${name}」已删除，列表已刷新；历史数据保留在数据库中供审计追溯。`,
            );
          }}
          onStatusChanged={(updated) => {
            setEditing(updated);
            setManagementSuccess(
              `项目「${updated.name}」状态已改为${projectLifecycleLabel(updated.status)}，当前版本 ${updated.rowVersion}。`,
            );
          }}
        />
      ) : null}
    </>
  );
};
