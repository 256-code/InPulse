import React, { useState } from "react";
import { Alert, Spin } from "antd";
import type { InpulseApiClient, ProjectItem } from "@generated/api";
import { InpulseIcon } from "@features/common/components/InpulseIcon";
import { CalmBadge, CalmEmptyState } from "@features/common/components/Calm";
import { ProjectLogo } from "@features/common/components/ProjectLogo";
import {
  ProjectContextNav,
  type ProjectContextNavActive,
  type ProjectContextNavModule,
} from "@features/common/components/ProjectContextNav";
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
  readonly onBackToProjects: () => void;
  /** 省略时不渲染「查看模块」入口（模块列表页自身已位于该层级）。 */
  readonly onOpenModules?: (() => void) | undefined;
  readonly onOpenMembers: () => void;
  readonly onOpenRecords: () => void;
  readonly onOpenIssues: () => void;
  /** 项目内导航的模块项（设计师稿 catalog.tsx L212 项目级导航）。 */
  readonly modules: readonly ProjectContextNavModule[];
  readonly onOpenModule: (moduleId: number) => void;
  readonly onOpenOverview: () => void;
  /** 项目内导航的高亮项；模块列表页传 `null`（该页不属于概览也不属于任一模块）。 */
  readonly navActive?: ProjectContextNavActive;
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
  onBackToProjects,
  onOpenModules,
  onOpenMembers,
  onOpenRecords,
  onOpenIssues,
  modules,
  onOpenModule,
  onOpenOverview,
  navActive = "overview",
  adapter,
  client,
  extraActions,
  children,
}) => {
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

  const metrics: ReadonlyArray<{
    readonly key: string;
    readonly label: string;
    readonly value: string;
  }> = [
    {
      key: "modules",
      label: "活跃模块",
      value: String(stats.activeModules),
    },
    {
      key: "features",
      label: "活跃功能",
      value: String(stats.activeFeatures),
    },
    {
      key: "tasks",
      label: "未完成任务",
      value: String(stats.openTasks),
    },
    {
      key: "records",
      label: "迭代记录",
      value: String(stats.publishedRecords),
    },
    {
      key: "members",
      label: "成员",
      value: project === null ? "—" : project.memberCount + " 人",
    },
    {
      key: "leftovers",
      label: "遗留问题",
      value: String(stats.openLeftovers),
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
      aria-label="项目概览"
      data-testid="project-overview"
    >
      <ProjectContextNav
        modules={modules}
        active={navActive}
        onSelectOverview={onOpenOverview}
        onSelectModule={onOpenModule}
      />
      <div className="project-detail-head">
        <button
          type="button"
          className="back-button"
          onClick={onBackToProjects}
        >
          <InpulseIcon name="arrowLeft" size={16} />
          全部项目
        </button>
        <div className="project-detail-title">
          {project === null ? (
            <span className="project-logo blue">—</span>
          ) : (
            <ProjectLogo code={project.code} />
          )}
          <div>
            <div className="eyebrow">
              {project === null
                ? "项目 / PROJECT"
                : project.code + " / PROJECT"}
            </div>
            <h1>
              {project === null
                ? projectLoading
                  ? "正在加载项目…"
                  : "项目概览"
                : project.name}
            </h1>
            <p>
              {project === null || project.description === ""
                ? "项目概览汇总模块、功能、任务与迭代记录，是进入项目内各模块的起点。"
                : project.description}
            </p>
          </div>
        </div>
        <div className="project-detail-actions">
          {project === null ? null : (
            <CalmBadge tone={project.status === "ACTIVE" ? "blue" : "amber"}>
              {project.status === "ACTIVE" ? "正常" : "已归档"}
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

      {/* 设计师稿 catalog.tsx L238-245：指标条由 `.project-overview-strip > div`
          直接承载（标签 + 数值，无图标），不要再加 `.overview-metric`——那是设计
          系统里给旧版 `.project-overview-metrics` 网格用的遗留类，会带进
          `min-height: 92px` 与 `strong` 的 `margin: 7px 0 4px`，把单项从 86px 撑到 92px。 */}
      <div className="project-overview-strip">
        {metrics.map((metric) => (
          <div key={metric.key} data-testid={"overview-metric-" + metric.key}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
          </div>
        ))}
      </div>

      {overviewQuery.isPending ? (
        <div className="calm-state">
          <Spin size="large" />
          <p>正在加载项目概览…</p>
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
        open={createTaskOpen}
        onClose={() => setCreateTaskOpen(false)}
        client={client}
        preset={project === null ? {} : { projectId: project.id }}
      />
    </section>
  );
};

export default ProjectOverviewPageView;
