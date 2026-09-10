/**
 * F-32 我的任务（跨项目列表）：筛选条件与列表项类型。
 *
 * 字段对齐 docs/c-aggregate-read-contract-proposal.md 的 R-3 草案
 * （MyTaskItem / MyTasksQueryRequest）。骨架 UI 另需 priority、dueAt、
 * completedAt、description、creatorId，该差异已登记开发日志，等待 A 裁决；
 * 契约冻结前不得把本文件当成路由契约来源。
 */

export type MyTaskScope = "mine" | "created" | "project" | "all";

export type MyTaskStatusFilter = "open" | "done" | "all";

export type MyTaskPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

export type MyTaskLevel = "FEATURE" | "MODULE";

export type MyTaskRelation = "STANDALONE" | "MAIN" | "SOURCE";

export type MyTaskRecordFilter = "yes" | "no";

export type MyTaskGithubFilter = "yes" | "no";

export type MyTaskDisplay = "cards" | "list";

export type MyTaskWorkStatus = "TODO" | "DONE" | "CANCELED";

/** 任务中心筛选状态；由 URL 承载（F-30），不使用组件内部副本。 */
export interface MyTaskFilters {
  readonly scope: MyTaskScope;
  readonly projectId: number | null;
  readonly status: MyTaskStatusFilter;
  readonly priority: MyTaskPriority | null;
  readonly level: MyTaskLevel | null;
  readonly relation: MyTaskRelation | null;
  readonly hasRecord: MyTaskRecordFilter | null;
  readonly hasGithub: MyTaskGithubFilter | null;
  readonly includeCanceled: boolean;
  readonly query: string;
  readonly display: MyTaskDisplay;
}

export interface MyTaskAssigneeRef {
  readonly userId: number;
  readonly name: string;
  readonly avatarUrl: string | null;
}

export interface MyTaskListItem {
  readonly taskId: number;
  readonly code: string;
  readonly title: string;
  readonly description: string;
  readonly projectId: number;
  readonly projectName: string;
  readonly moduleId: number;
  readonly moduleName: string;
  readonly featureId: number | null;
  readonly featureName: string | null;
  readonly scopeType: MyTaskLevel;
  readonly workStatus: MyTaskWorkStatus;
  readonly lifecycleStatus: "ACTIVE" | "ARCHIVED" | "INVALID";
  readonly priority: MyTaskPriority;
  readonly dueAt: string | null;
  readonly updatedAt: string;
  readonly completedAt: string | null;
  readonly creatorId: number;
  readonly assignee: MyTaskAssigneeRef;
  readonly hasPublishedRecord: boolean;
  readonly groupRole: "MAIN" | "SOURCE" | null;
  readonly githubLinkCount: number;
}

/** 统计卡片口径；与列表筛选相互独立，按当前范围（scope/project）计算。 */
export interface MyTaskStats {
  readonly myOpen: number;
  readonly dueToday: number;
  readonly overdue: number;
  readonly completedThisMonth: number;
}

export interface MyTaskLeftoverSample {
  readonly recordCode: string;
  readonly summary: string;
}

export interface MyTaskListResult {
  readonly items: readonly MyTaskListItem[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
  readonly stats: MyTaskStats;
  readonly scopeCounts: Readonly<Record<MyTaskScope, number>>;
  readonly leftoverCount: number;
  readonly leftoverSample: MyTaskLeftoverSample | null;
}

export interface MyTasksQueryInput {
  readonly filters: MyTaskFilters;
  readonly viewerId: number | null;
}

/** 数据源适配器；骨架阶段只有 mock 实现，接口冻结后新增 server 实现。 */
export interface MyTasksAdapter {
  readonly source: "mock" | "server";
  readonly notice: string;
  fetchMyTasks(input: MyTasksQueryInput): Promise<MyTaskListResult>;
}
