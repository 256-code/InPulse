/**
 * F-29 项目概览（骨架）：统计指标、最近迭代与待处理遗留问题。
 *
 * 指标口径对齐 docs/c-port-extension-proposal.md §2.1（功能设计 §9.5）：
 * 活跃模块、活跃功能、未完成任务、迭代记录、最近迭代、待处理遗留问题；
 * 项目名、状态与成员数来自 A 的既有项目端口（getProject），不经过本适配器。
 * 默认数据源为 server adapter（R-2 getProjectOverview，见 project-overview-server.ts）；
 * mock adapter 只保留用于前端测试与降级演示。R-2 契约未提供的字段
 * （openLeftovers 总数、leftover.recordTitle）以 null 标记，
 * 显示层必须显式降级，不得静默忽略或虚构数值。
 */

export interface ProjectOverviewStats {
  readonly activeModules: number;
  readonly activeFeatures: number;
  readonly openTasks: number;
  readonly publishedRecords: number;
  /** R-2 契约未提供总数；null 表示不可知，显示层不得虚构。 */
  readonly openLeftovers: number | null;
}

export interface ProjectOverviewIteration {
  readonly recordId: number;
  readonly code: string;
  readonly title: string;
  readonly featureName: string | null;
  readonly publishedAt: string;
}

export interface ProjectOverviewLeftover {
  readonly leftoverId: number;
  readonly summary: string;
  readonly recordCode: string;
  /** R-2 契约未提供来源记录标题；null 表示不可知，显示层只展示编号。 */
  readonly recordTitle: string | null;
}

export interface ProjectOverviewResult {
  readonly stats: ProjectOverviewStats;
  readonly recentIterations: readonly ProjectOverviewIteration[];
  readonly leftovers: readonly ProjectOverviewLeftover[];
}

export interface ProjectOverviewQueryInput {
  readonly projectId: number;
}

export interface ProjectOverviewAdapter {
  readonly source: "mock" | "server";
  readonly notice: string;
  fetchProjectOverview(
    input: ProjectOverviewQueryInput,
  ): Promise<ProjectOverviewResult>;
}
