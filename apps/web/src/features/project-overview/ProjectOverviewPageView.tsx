import { ProjectRepositoryLink } from "@features/external-links/ProjectRepositoryLink";
import { useNavigate } from "react-router-dom";
import { taskDetailPath } from "@features/tasks/task-links";
import React, { useState } from "react";
import { Alert, Spin } from "antd";
import type { InpulseApiClient, ProjectItem } from "@generated/api";
import {
  InpulseIcon,
  type InpulseIconName,
} from "@features/common/components/InpulseIcon";
import { CalmBadge, CalmEmptyState } from "@features/common/components/Calm";
import {
  projectLifecycleLabel,
  projectLifecycleTone,
} from "@features/common/resource-lifecycle";
import { ProjectLogo } from "@features/common/components/ProjectLogo";
import { GlobalTaskCreateModal } from "@features/tasks/GlobalTaskCreateModal";
import { PROJECT_OVERVIEW_MOCK_ADAPTER } from "./project-overview-mock";
import {
  describeProjectOverviewError,
  useProjectOverviewQuery,
} from "./project-overview-query";
import type {
  ProjectOverviewAdapter,
  ProjectOverviewIteration,
  ProjectOverviewLeftover,
} from "./project-overview-types";

function formatPublishedAt(iso: string): string {
  const date = new Date(iso);
  return date.getMonth() + 1 + "月" + date.getDate() + "日";
}

export interface ProjectOverviewPageViewProps {
  readonly projectId: number;
  readonly project: ProjectItem | null;
  readonly projectLoading: boolean;
  readonly projectError?: string | undefined;
  readonly onRetryProject: () => void;
  /** 省略时不渲染「查看模块」入口（模块列表页自身已位于该层级）。 */
  readonly onOpenModules?: (() => void) | undefined;
  readonly onOpenMembers: () => void;
  readonly onOpenRecords: () => void;
  readonly onOpenIssues: () => void;
  readonly adapter?: ProjectOverviewAdapter;
  readonly client?: InpulseApiClient | undefined;
  /**
   * 项目头部动作区（`.project-detail-actions`）里「成员与设置」与「新建任务」
   * 之间的附加按钮；设计师稿 catalog.tsx L233 的「新增模块」即落在这里。
   */
  readonly extraActions?: React.ReactNode;
  /** 指标条与面板之后渲染的页面主体（模块列表页注入模块网格）。 */
  readonly children?: React.ReactNode;
}

/**
 * F-29 项目概览视图。项目名、状态与成员数来自 A 的项目端口（调用方注入）；
 * 统计卡片、最近迭代与遗留问题来自注入的 adapter：页面默认注入 server
 * adapter（R-2 getProjectOverview），mock 只用于测试与降级演示。
 * 第二轮契约扩展后遗留问题总数与来源记录标题均已接线，无降级展示。
 */
export const ProjectOverviewPageView: React.FC<
  ProjectOverviewPageViewProps
> = ({
  projectId,
  project,
  projectLoading,
  projectError,
  onRetryProject,
  onOpenModules,
  onOpenMembers,
  onOpenRecords,
  onOpenIssues,
  adapter,
  client,
  extraActions,
  children,
}) => {
  const navigate = useNavigate();
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const activeAdapter = adapter ?? PROJECT_OVERVIEW_MOCK_ADAPTER;
  const overviewQuery = useProjectOverviewQuery({
    projectId,
    adapter: activeAdapter,
  });
  const result = overviewQuery.data;
  const stats = result?.stats ?? {
    activeModules: 0,
    activeFeatures: 0,
    openTasks: 0,
    publishedRecords: 0,
    openLeftovers: 0,
  };
  const iterations = result?.recentIterations ?? [];
  const leftovers = result?.leftovers ?? [];

  // 指标小卡只保留任务/记录/成员/遗留四项：活跃模块与活跃功能按用户要求
  // 从展示层取消（服务端口径不变，仍由 R-2 提供，供后续接线）。
  const metrics: ReadonlyArray<{
    readonly key: string;
    readonly label: string;
    readonly value: string;
    readonly icon: InpulseIconName;
    readonly tone: string;
  }> = [
    {
      key: "tasks",
      label: "未完成任务",
      value: String(stats.openTasks),
      icon: "clipboard",
      tone: "blue",
    },
    {
      key: "records",
      label: "迭代记录",
      value: String(stats.publishedRecords),
      icon: "gitBranch",
      tone: "green",
    },
    {
      key: "members",
      label: "成员",
      value: project === null ? "—" : project.memberCount + " 人",
      icon: "users",
      tone: "amber",
    },
    {
      key: "leftovers",
      label: "遗留问题",
      value: String(stats.openLeftovers),
      icon: "alert",
      tone: "red",
    },
  ];

  const renderIteration = (item: ProjectOverviewIteration) => (
    <li key={item.recordId}>
      <button type="button" onClick={onOpenRecords}>
        <InpulseIcon name="gitBranch" size={15} />
        <span>
          {item.featureName === null ? "" : item.featureName + "："}
          {item.title}
          <small>
            {item.code} · {formatPublishedAt(item.publishedAt)}
          </small>
        </span>
        <InpulseIcon name="chevronRight" size={14} />
      </button>
    </li>
  );

  const renderLeftover = (item: ProjectOverviewLeftover) => (
    <li key={item.leftoverId}>
      <button type="button" onClick={onOpenIssues}>
        <InpulseIcon name="alert" size={15} />
        <span>
          {item.summary}
          <small>{"来自 " + item.recordCode + " " + item.recordTitle}</small>
        </span>
        <InpulseIcon name="chevronRight" size={14} />
      </button>
    </li>
  );

  return (
    <section
      className="project-overview"
      aria-label="项目主页"
      data-testid="project-overview"
    >
      <div className="project-detail-head">
        <div className="project-detail-title">
          {project === null ? (
            <span className="project-logo blue">—</span>
          ) : (
            <ProjectLogo code={project.code} />
          )}
          <div>
            <h1>
              {project === null
                ? projectLoading
                  ? "正在加载项目…"
                  : "项目主页"
                : project.name}
            </h1>
            <p>
              {project === null || project.description === ""
                ? "这里汇总项目的模块、功能、任务与迭代记录，从模块开始进入项目。"
                : project.description}
            </p>
          </div>
        </div>
        <div className="project-detail-actions">
          <ProjectRepositoryLink projectId={projectId} client={client} />
          {project === null ? null : (
            <CalmBadge tone={projectLifecycleTone(project.status, "blue")}>
              {projectLifecycleLabel(project.status)}
            </CalmBadge>
          )}
          {onOpenModules === undefined ? null : (
            <button
              type="button"
              className="secondary-button"
              onClick={onOpenModules}
            >
              <InpulseIcon name="boxes" size={15} />
              查看模块
            </button>
          )}
          <button
            type="button"
            className="secondary-button"
            onClick={onOpenMembers}
          >
            <InpulseIcon name="users" size={15} />
            成员与设置
          </button>
          {extraActions}
          <button
            type="button"
            className="primary-button"
            disabled={project === null || project.status === "ARCHIVED"}
            onClick={() => setCreateTaskOpen(true)}
          >
            <InpulseIcon name="plus" size={16} />
            新建任务
          </button>
        </div>
      </div>

      {projectError === undefined ? null : (
        <Alert
          type="error"
          title={projectError}
          action={
            <button
              type="button"
              className="text-button"
              onClick={onRetryProject}
            >
              重试
            </button>
          }
        />
      )}

      {activeAdapter.source === "mock" ? (
        <div
          className="skeleton-note"
          data-testid="project-overview-mock-notice"
        >
          <InpulseIcon name="alert" size={16} />
          <span>
            <strong>骨架数据：</strong>
            {activeAdapter.notice}
          </span>
        </div>
      ) : null}

      {/* 指标小卡：标签在上、彩色图标 + 数值在下，白底圆角软阴影，
          按用户确认的紧凑卡片排版替换原四列通栏指标条。 */}
      <div className="project-overview-strip">
        {metrics.map((metric) => (
          <div key={metric.key} data-testid={"overview-metric-" + metric.key}>
            <span>{metric.label}</span>
            <div className="metric-value">
              <i className={"metric-icon tone-" + metric.tone}>
                <InpulseIcon name={metric.icon} size={14} />
              </i>
              <strong>{metric.value}</strong>
            </div>
          </div>
        ))}
      </div>

      {overviewQuery.isPending ? (
        <div className="calm-state">
          <Spin size="large" />
          <p>正在加载项目…</p>
        </div>
      ) : overviewQuery.isError ? (
        <Alert
          type="error"
          title={describeProjectOverviewError(overviewQuery.error)}
        />
      ) : (
        <div className="project-overview-panels">
          <section
            className="overview-panel"
            aria-labelledby="overview-iterations-title"
          >
            <div className="panel-head">
              <div>
                <h2 id="overview-iterations-title">最近迭代</h2>
                <p>项目内最新发布的记录</p>
              </div>
              <button
                type="button"
                className="text-button"
                onClick={onOpenRecords}
              >
                查看全部
                <InpulseIcon name="chevronRight" size={15} />
              </button>
            </div>
            {iterations.length > 0 ? (
              <ul className="mini-record-list">
                {iterations.map(renderIteration)}
              </ul>
            ) : (
              <CalmEmptyState
                icon="calendar"
                title="暂无已发布记录"
                description="记录发布后，最新迭代会出现在这里。"
              />
            )}
          </section>

          <section
            className="overview-panel"
            aria-labelledby="overview-leftovers-title"
          >
            <div className="panel-head">
              <div>
                <h2 id="overview-leftovers-title">待处理遗留问题</h2>
                <p>确认影响范围后转为任务</p>
              </div>
              <button
                type="button"
                className="text-button"
                onClick={onOpenIssues}
              >
                进入遗留问题
                <InpulseIcon name="chevronRight" size={15} />
              </button>
            </div>
            {leftovers.length > 0 ? (
              <ul className="mini-record-list">
                {leftovers.map(renderLeftover)}
              </ul>
            ) : (
              <CalmEmptyState
                icon="check"
                title="没有待闭环的遗留问题"
                description="新的遗留问题会在记录发布后进入这里。"
              />
            )}
          </section>
        </div>
      )}

      {children}

      <GlobalTaskCreateModal
        onCreatedLocation={(task) => navigate(taskDetailPath(task))}
        open={createTaskOpen}
        onClose={() => setCreateTaskOpen(false)}
        client={client}
        preset={project === null ? {} : { projectId: project.id }}
      />
    </section>
  );
};

export default ProjectOverviewPageView;
