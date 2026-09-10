/**
 * F-29 项目概览（骨架）：统计指标、最近迭代与待处理遗留问题。
 *
 * 指标口径对齐 docs/c-port-extension-proposal.md §2.1（功能设计 §9.5）：
 * 活跃模块、活跃功能、未完成任务、迭代记录、最近迭代、待处理遗留问题；
 * 项目名、状态与成员数来自 A 的既有项目端口（getProject），不经过本适配器。
 * 骨架阶段聚合数据由 mock adapter 提供（§7.5 授权），接口冻结后只替换 adapter。
 */

export interface ProjectOverviewStats {
  readonly activeModules: number;
  readonly activeFeatures: number;
  readonly openTasks: number;
  readonly publishedRecords: number;
  readonly openLeftovers: number;
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
  readonly recordTitle: string;
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
