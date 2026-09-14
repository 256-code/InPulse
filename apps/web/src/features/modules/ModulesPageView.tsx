import React, { useMemo, useState } from "react";
import { Alert, Button, Spin } from "antd";
import { useNavigate } from "react-router-dom";
import { type InpulseApiClient, type ModuleItem } from "@generated/api";
import { InpulseIcon } from "@features/common/components/InpulseIcon";
import { isCardClick } from "@features/common/card-click";
import {
  CalmBadge,
  CalmEmptyState,
  CalmSectionTitle,
} from "@features/common/components/Calm";
import { ProjectOverviewPageView } from "@features/project-overview/ProjectOverviewPageView";
import { createProjectOverviewServerAdapter } from "@features/project-overview/project-overview-server";
import { useProjectDetail } from "@features/projects/project-query";
import { moduleErrorMessage, useModules } from "./module-query";
import {
  ModuleEditorModal,
  type ModuleEditorRequest,
} from "./ModuleEditorModal";

export function ModulesPageView({
  projectId,
  isAdmin,
  client,
}: {
  projectId: number;
  isAdmin: boolean;
  client?: InpulseApiClient | undefined;
}) {
  const { query } = useModules(projectId, client);
  const navigate = useNavigate();
  const [request, setRequest] = useState<ModuleEditorRequest | null>(null);
  const [success, setSuccess] = useState(false);
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
  const projectName = projectQuery.data?.name ?? null;
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
          project={projectQuery.data ?? null}
          projectLoading={projectQuery.isPending}
          onRetryProject={() => void projectQuery.refetch()}
          onBackToProjects={() => navigate("/projects")}
          // 设计师稿 catalog.tsx L214：项目页的「项目概览」是当前页签（自指），
          // 模块网格与概览同页，因此不再跳到不含模块的 /overview。
          onOpenOverview={() => navigate("/projects/" + projectId + "/modules")}
          onOpenModule={onOpenModule}
          onOpenMembers={() => navigate("/projects/" + projectId + "/members")}
          onOpenRecords={() =>
            navigate("/records?view=published&projectId=" + projectId)
          }
          onOpenIssues={() => navigate("/issues")}
          modules={query.data?.items ?? []}
          // 设计师稿 catalog.tsx L214：进入项目页后「项目概览」恒为 active。
          navActive="overview"
          adapter={overviewAdapter}
          extraActions={
            // 设计师稿 catalog.tsx L233：`.project-detail-actions` 内的「新增模块」
            //（secondary）与 L307 SectionTitle 行内的「新增模块」（primary）是设计
            // 稿同时存在的两个入口，共用同一个模块编辑器。
            <Button className="secondary-button" onClick={() => open("create")}>
              <InpulseIcon name="plus" size={15} />
              新增模块
            </Button>
          }
        >
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
              description="项目创建时会自动生成未分类模块，可继续拆分为具体业务模块。"
            >
              <Button className="primary-button" onClick={() => open("create")}>
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
                <Button
                  className="primary-button"
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
                      className={
                        "calm-feature-card module-card" +
                        (item.status === "ARCHIVED" ? " card-archived" : "")
                      }
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
                        <span className="task-id">模块 #{item.id}</span>
                      </div>
                      <h2>{item.name}</h2>
                      <div className="task-card-badges">
                        {item.kind === "UNCLASSIFIED" && (
                          <CalmBadge tone="violet">未分类</CalmBadge>
                        )}
                        <CalmBadge
                          tone={item.status === "ACTIVE" ? "gray" : "amber"}
                        >
                          {item.status === "ACTIVE" ? "正常" : "已归档"}
                        </CalmBadge>
                      </div>
                      <p>{item.description || "暂无模块说明"}</p>
                      <div className="card-footer">
                        <span>
                          {item.stats.activeFeatureCount} 个功能 ·{" "}
                          {item.stats.openTaskCount} 项待办
                        </span>
                        <Button
                          className="text-button"
                          href={
                            "/projects/" +
                            projectId +
                            "/modules/" +
                            item.id +
                            "/features"
                          }
                        >
                          查看功能
                          <InpulseIcon name="chevronRight" size={14} />
                        </Button>
                      </div>
                    </div>
                    <span className="catalog-edit-link">
                      <Button
                        className="text-button"
                        href={
                          "/projects/" +
                          projectId +
                          "/modules/" +
                          item.id +
                          "/tasks"
                        }
                      >
                        模块任务
                      </Button>
                      {item.status === "ACTIVE" && (
                        <Button
                          className="text-button"
                          onClick={() => open("update", item)}
                        >
                          编辑模块
                        </Button>
                      )}
                      {isAdmin && (
                        <Button
                          className="text-button"
                          onClick={() =>
                            open(
                              item.status === "ACTIVE" ? "archive" : "restore",
                              item,
                            )
                          }
                        >
                          {item.status === "ACTIVE" ? "归档模块" : "恢复模块"}
                        </Button>
                      )}
                    </span>
                  </article>
                ))}
              </div>
            </>
          )}
        </ProjectOverviewPageView>
      </div>
      <ModuleEditorModal
        projectId={projectId}
        client={client}
        projectName={projectName}
        request={request}
        onClose={() => setRequest(null)}
        onSaved={() => setSuccess(true)}
      />
    </>
  );
}
