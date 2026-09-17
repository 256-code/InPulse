import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "antd";
import { createApiClient, type InpulseApiClient } from "@generated/api";
import {
  CalmBadge,
  CalmEmptyState,
  CalmSectionTitle,
} from "@features/common/components/Calm";
import { InpulseIcon } from "@features/common/components/InpulseIcon";
import {
  projectLifecycleLabel,
  projectLifecycleTone,
} from "@features/common/resource-lifecycle";
import { useProjectDetail } from "./project-query";
import { projectMemberErrorMessage } from "./project-member-query";

const formatMemberDate = (value: string) =>
  new Date(value).toLocaleString("zh-CN", { hour12: false });

/**
 * 普通成员视角的项目成员只读视图：复用管理员 `ProjectMembersPageView` 的
 * 视觉语言（page-header / settings-panel / project-facts / calm-member-card），
 * 但去掉全部写操作（添加、移除、任务重指派、归档、项目切换）。
 * 数据来自 `listActiveProjectMembers`（仅返回活跃成员的 id/name/avatarUrl），
 * 因此成员卡片不含加入时间与历史状态，只标注「活跃成员」。
 */
export function ActiveProjectMembers({
  projectId,
  client,
}: {
  projectId: number;
  client?: InpulseApiClient | undefined;
}) {
  const api = useMemo(() => client ?? createApiClient(), [client]);
  const project = useProjectDetail({ projectId, client });
  const members = useQuery({
    queryKey: ["active-project-members", projectId],
    queryFn: ({ signal }) =>
      api.listActiveProjectMembers(projectId, { signal }),
    retry: false,
  });
  const items = members.data?.items ?? [];
  const projectDetail = project.data?.project ?? null;
  const creatorName =
    projectDetail === null
      ? undefined
      : items.find((member) => member.id === projectDetail.createdBy)?.name;

  return (
    <>
      <div className="page-header">
        <div>
          <span className="eyebrow">项目 / 成员</span>
          <h1>{projectDetail ? projectDetail.name : "项目成员"}</h1>
          <p>
            当前项目的活跃成员为只读视图；成员的添加与移除由系统管理员处理。
          </p>
        </div>
        {projectDetail ? (
          <div className="catalog-actions">
            <CalmBadge
              tone={projectLifecycleTone(projectDetail.status, "blue")}
            >
              {projectLifecycleLabel(projectDetail.status)}
            </CalmBadge>
          </div>
        ) : null}
      </div>

      {members.isPending ? (
        <div className="calm-state">
          <span className="calm-spinner" />
          <span>正在加载项目成员</span>
        </div>
      ) : members.isError ? (
        <CalmEmptyState
          icon="alert"
          title="项目成员加载失败"
          description={projectMemberErrorMessage(members.error)}
        >
          <Button
            className="secondary-button"
            onClick={() => void members.refetch()}
          >
            重试
          </Button>
        </CalmEmptyState>
      ) : items.length === 0 ? (
        <CalmEmptyState
          icon="users"
          title="暂无项目成员"
          description="项目还没有活跃成员；成员由系统管理员添加。"
        />
      ) : (
        <section className="panel settings-panel">
          <div className="settings-panel-head">
            <CalmSectionTitle
              title="项目成员"
              hint={`共 ${items.length} 名活跃成员 · 只读视图`}
            />
          </div>
          {projectDetail ? (
            <dl className="calm-meta project-facts">
              <dt>项目编码</dt>
              <dd>
                <code>{projectDetail.code}</code>
              </dd>
              <dt>状态</dt>
              <dd>{projectLifecycleLabel(projectDetail.status)}</dd>
              <dt>创建人</dt>
              <dd>{creatorName ?? "—"}（仅溯源，不授予额外权限）</dd>
              <dt>创建时间</dt>
              <dd>{formatMemberDate(projectDetail.createdAt)}</dd>
              <dt>当前成员</dt>
              <dd>{items.map((member) => member.name).join("、")}</dd>
            </dl>
          ) : null}

          <div className="member-editor">
            <div className="member-selection-top">
              <strong>成员列表</strong>
            </div>
            <div className="member-history-list">
              {items.map((member) => (
                <article key={member.id} className="calm-member-card">
                  <div className="calm-member-card-main">
                    <span className="person-avatar member-avatar">
                      {member.name.slice(0, 1)}
                    </span>
                    <div className="member-identity">
                      <strong>
                        {member.name}
                        {projectDetail && member.id === projectDetail.createdBy
                          ? "（创建者）"
                          : ""}
                      </strong>
                      <span>项目活跃成员</span>
                    </div>
                  </div>
                  <div className="member-status">
                    <CalmBadge tone="green">活跃成员</CalmBadge>
                  </div>
                </article>
              ))}
            </div>
            <div className="calm-action-footer">
              <Button
                className="secondary-button"
                onClick={() => void members.refetch()}
              >
                刷新成员
              </Button>
            </div>
            <p className="permission-hint">
              <InpulseIcon name="shield" size={15} />
              <span>
                成员关系由系统管理员维护；此页面仅供查看当前项目的活跃成员，
                不提供添加、移除或任务改派能力。
              </span>
            </p>
          </div>
        </section>
      )}
    </>
  );
}
