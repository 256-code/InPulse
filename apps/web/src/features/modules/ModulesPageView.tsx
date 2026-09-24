import React, { useMemo, useState } from "react";
import { Alert, Button, Spin } from "antd";
import { useNavigate } from "react-router-dom";
import {
  createApiClient,
  type InpulseApiClient,
  type ModuleItem,
  type ProjectDetailResponse,
  type ProjectItem,
} from "@generated/api";
import { useQueryClient } from "@tanstack/react-query";
import {
  RecordDetailModal,
  type RecordDetailTarget,
} from "@features/published-records/RecordDetailModal";
import type { ProjectOverviewIteration } from "@features/project-overview/project-overview-types";
import { InpulseIcon } from "@features/common/components/InpulseIcon";
import { isCardClick } from "@features/common/card-click";
import {
  moduleLifecycleLabel,
  moduleLifecycleTone,
  projectLifecycleLabel,
} from "@features/common/resource-lifecycle";
import {
  CalmBadge,
  CalmEmptyState,
  CalmSectionTitle,
} from "@features/common/components/Calm";
import { ProjectOverviewPageView } from "@features/project-overview/ProjectOverviewPageView";
import { createProjectOverviewServerAdapter } from "@features/project-overview/project-overview-server";
import {
  ProjectWorkspaceModals,
  type ProjectWorkspaceModalKind,
} from "@features/project-overview/ProjectWorkspaceModals";
import { useAuth } from "@features/auth/auth-context";
import { EditProjectModal } from "@features/projects/ProjectManagementModals";
import {
  canManageProjectResources,
  useProjectDetail,
} from "@features/projects/project-query";
import { moduleErrorMessage, useModules } from "./module-query";
import {
  ModuleEditorModal,
  type ModuleEditorRequest,
} from "./ModuleEditorModal";

export function ModulesPageView({
  projectId,
  client,
}: {
  projectId: number;
  client?: InpulseApiClient | undefined;
}) {
  const { query } = useModules(projectId, client);
  const navigate = useNavigate();
  const [request, setRequest] = useState<ModuleEditorRequest | null>(null);
  const [success, setSuccess] = useState(false);
  /** 成员与设置 / 迭代记录 / 遗留问题：就地弹窗，不再整页跳转。 */
  const [workspaceModal, setWorkspaceModal] =
    useState<ProjectWorkspaceModalKind | null>(null);
  /** 「最近迭代」单行：就地打开该条记录的详情弹窗。 */
  const [recordTarget, setRecordTarget] =
    useState<ProjectOverviewIteration | null>(null);
  /** 项目名旁的「编辑项目」弹窗，以及保存后的页头提示。 */
  const [projectEditOpen, setProjectEditOpen] = useState(false);
  const [projectNotice, setProjectNotice] = useState<string | null>(null);
  const api = useMemo(() => client ?? createApiClient(), [client]);
  const queryClient = useQueryClient();
  const open = (action: ModuleEditorRequest["action"], item?: ModuleItem) => {
    setSuccess(false);
    setRequest({ action, ...(item ? { item } : {}) });
  };
  const onOpenModule = (moduleId: number) =>
    navigate("/projects/" + projectId + "/modules/" + moduleId + "/features");
  const projectQuery = useProjectDetail({
    client,
    projectId,
  });
  const projectName = projectQuery.data?.project?.name ?? null;
  const { user } = useAuth();
  // ADR-039：项目内管理入口对全体活跃成员与系统管理员开放。
  const canManageProject = canManageProjectResources(
    user?.isAdmin === true,
    projectQuery.data?.currentUserRole ?? null,
  );
  /**
   * 编辑项目或切换状态成功后就地回写详情缓存：弹窗继续操作时拿到的是服务端
   * 返回的新 rowVersion，不会拿旧版本撞 409；mutation 自身的失效随后从服务端校准。
   */
  const applyProjectUpdate = (updated: ProjectItem) => {
    const detail = queryClient.getQueryData<ProjectDetailResponse>([
      "projects",
      "detail",
      projectId,
    ]);
    if (detail === undefined) return;
    queryClient.setQueryData(["projects", "detail", projectId], {
      ...detail,
      project: updated,
    });
  };
  const overviewAdapter = useMemo(
    () => createProjectOverviewServerAdapter(client),
    [client],
  );
  return (
    <>
      <div className="module-workspace-page">
        <ProjectOverviewPageView
          projectId={projectId}
          client={client}
          project={projectQuery.data?.project ?? null}
          projectLoading={projectQuery.isPending}
          onRetryProject={() => void projectQuery.refetch()}
          onBack={() => navigate("/projects")}
          onOpenMembers={() => setWorkspaceModal("members")}
          onOpenRecords={() => setWorkspaceModal("records")}
          onOpenRecord={setRecordTarget}
          onOpenIssues={() => setWorkspaceModal("issues")}
          adapter={overviewAdapter}
          onEditProject={
            canManageProject ? () => setProjectEditOpen(true) : undefined
          }
        >
          {projectNotice && (
            <Alert type="success" showIcon title={projectNotice} />
          )}
          {success && <Alert type="success" showIcon title="模块操作成功" />}
          {query.isPending ? (
            <div className="calm-state">
              <Spin />
              <span>正在加载模块</span>
            </div>
          ) : query.isError ? (
            <Alert
              type="error"
              title={moduleErrorMessage(query.error)}
              action={
                <Button
                  className="secondary-button"
                  onClick={() => void query.refetch()}
                >
                  重试
                </Button>
              }
            />
          ) : !query.data?.items.length ? (
            <CalmEmptyState
              icon="boxes"
              title="暂无模块"
              description="创建一个业务模块，也可以在新建任务时同时创建模块。"
            >
              <Button
                className="soft-blue-button"
                onClick={() => open("create")}
              >
                <InpulseIcon name="plus" size={15} />
                新增模块
              </Button>
            </CalmEmptyState>
          ) : (
            <>
              <CalmSectionTitle
                title="模块"
                hint={`${(query.data?.items ?? []).length} 个模块 · 模块负责分类，功能负责沉淀`}
              >
                {/* 模块区块标题行是页面唯一的常驻新增入口：设计稿在页头动作区
                    还有一个同名按钮，按产品要求删掉重复入口。 */}
                <Button
                  className="soft-blue-button"
                  onClick={() => open("create")}
                >
                  <InpulseIcon name="plus" size={15} />
                  新增模块
                </Button>
              </CalmSectionTitle>
              <div className="calm-feature-grid">
                {query.data.items.map((item) => (
                  <article className="catalog-module-wrap" key={item.id}>
                    <div
                      className="calm-feature-card module-card"
                      onClick={(event) => {
                        if (!isCardClick(event)) return;
                        onOpenModule(item.id);
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        if (event.target !== event.currentTarget) return;
                        event.preventDefault();
                        onOpenModule(item.id);
                      }}
                      tabIndex={0}
                    >
                      <div className="calm-card-top">
                        <span className="feature-symbol">
                          <InpulseIcon name="boxes" size={21} />
                        </span>
                        <span className="task-id">{item.code}</span>
                      </div>
                      <h2>{item.name}</h2>
                      <div className="task-card-badges">
                        {item.kind === "UNCLASSIFIED" && (
                          <CalmBadge tone="violet">未分类</CalmBadge>
                        )}
                        <CalmBadge
                          tone={moduleLifecycleTone(
                            item.stats.completedTaskCount,
                            "blue",
                          )}
                        >
                          {moduleLifecycleLabel(item.stats.completedTaskCount)}
                        </CalmBadge>
                      </div>
                      <p>{item.description || "暂无模块说明"}</p>
                      <div className="card-footer">
                        <span>
                          {item.stats.activeFeatureCount} 个功能 ·{" "}
                          {item.stats.openTaskCount} 项待办
                        </span>
                        {/* 整卡点击已经进入模块页，卡内只留「编辑模块」一个动作：
                            查看功能由整卡点击承担，模块任务在模块页「模块级任务」
                            页签。ADR-044：模块已无归档/恢复动作。 */}
                        <Button
                          className="text-button"
                          onClick={() => open("update", item)}
                        >
                          编辑模块
                        </Button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </ProjectOverviewPageView>
      </div>
      <RecordDetailModal
        projectId={projectId}
        api={api}
        record={
          recordTarget === null
            ? null
            : ({
                recordId: recordTarget.recordId,
                code: recordTarget.code,
                title: recordTarget.title,
                recordStatus: "PUBLISHED",
                publishedAt: recordTarget.publishedAt,
                contextLabel: recordTarget.featureName,
                externalLinks: [],
              } satisfies RecordDetailTarget)
        }
        onClose={() => setRecordTarget(null)}
        onChanged={() => {
          // 修订/作废后同步概览统计与最近迭代列表。
          void queryClient.invalidateQueries({
            queryKey: ["project-overview", projectId],
          });
        }}
      />
      <ProjectWorkspaceModals
        projectId={projectId}
        client={client}
        open={workspaceModal}
        onClose={() => setWorkspaceModal(null)}
      />
      <ModuleEditorModal
        projectId={projectId}
        client={client}
        projectName={projectName}
        request={request}
        onClose={() => setRequest(null)}
        onSaved={() => setSuccess(true)}
      />
      {projectEditOpen && projectQuery.data?.project ? (
        <EditProjectModal
          open
          project={projectQuery.data.project}
          client={client}
          canChangeStatus={canManageProject}
          onClose={() => setProjectEditOpen(false)}
          onUpdated={(updated) => {
            applyProjectUpdate(updated);
            setProjectEditOpen(false);
            setProjectNotice(
              `项目「${updated.name}」已更新，当前版本 v${updated.rowVersion}。`,
            );
          }}
          onStatusChanged={(updated) => {
            applyProjectUpdate(updated);
            setProjectNotice(
              `项目状态已改为${projectLifecycleLabel(updated.status)}。`,
            );
          }}
        />
      ) : null}
    </>
  );
}
