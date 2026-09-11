import type { TaskGroupListItem } from "@generated/api";

/**
 * F-32 我的任务（跨项目列表）：筛选条件与列表项类型。
 *
 * 字段对齐 docs/a-contract-review-f25-f29-f32.md 的冻结 R-3 DTO
 * （MyTaskItem / MyTasksQueryRequest）：契约可表达的字段为必填；
 * 骨架 UI 需要但契约未提供的字段（description / priority / dueAt /
 * completedAt / creatorId / githubLinkCount）为可选，未提供时为 undefined，
 * 显示层必须显式降级，不得静默忽略或虚构数值。
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
  /** R-3 契约未提供；undefined 表示不可知，显示层不得展示描述。 */
  readonly description?: string | null;
  readonly projectId: number;
  readonly projectName: string;
  readonly moduleId: number;
  readonly moduleName: string;
  readonly featureId: number | null;
  readonly featureName: string | null;
  readonly scopeType: MyTaskLevel;
  readonly workStatus: MyTaskWorkStatus;
  readonly lifecycleStatus: "ACTIVE" | "ARCHIVED" | "INVALID";
  /** R-3 契约未提供；undefined 表示不可知，显示层隐藏优先级徽章。 */
  readonly priority?: MyTaskPriority;
  /**
   * undefined 表示 R-3 契约未提供截止时间；null 表示确实未设置截止。
   * 两者的显示文案不同，不得混用。
   */
  readonly dueAt?: string | null;
  readonly updatedAt: string;
  /** R-3 契约未提供；undefined 表示不可知。 */
  readonly completedAt?: string | null;
  /** R-3 契约未提供；undefined 表示不可知。 */
  readonly creatorId?: number;
  readonly assignee: MyTaskAssigneeRef;
  readonly hasPublishedRecord: boolean;
  readonly groupRole: "MAIN" | "SOURCE" | null;
  /** R-3 契约未提供；undefined 表示不可知。 */
  readonly githubLinkCount?: number;
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

/**
 * UI 筛选面相对冻结 R-3 契约的缺口（参数维度）。
 *
 * 这些筛选在设计师稿与骨架 UI 中存在，但 R-3 的冻结参数无法表达；
 * 服务端适配器必须显式降级（禁用或标注「后续迭代」），不得静默忽略，
 * 也不得把未登记的参数提前写进请求。
 */
export type MyTasksFilterGap =
  | "scope:created"
  | "scope:all"
  | "scope:project-without-id"
  | "filter:priority"
  | "filter:relation"
  | "filter:github"
  | "filter:query"
  | "filter:canceled-with-open";

/** 适配器对每个缺口的表达能力；false 表示该筛选必须显式降级。 */
export type MyTasksFilterSupport = Readonly<Record<MyTasksFilterGap, boolean>>;

/** mock 适配器完整支持全部筛选（演示数据集在本地过滤）。 */
export const MY_TASKS_FULL_FILTER_SUPPORT: MyTasksFilterSupport = {
  "scope:created": true,
  "scope:all": true,
  "scope:project-without-id": true,
  "filter:priority": true,
  "filter:relation": true,
  "filter:github": true,
  "filter:query": true,
  "filter:canceled-with-open": true,
};

/**
 * R-7 聚合组列表：直接消费服务端 DTO（MyTaskGroupItem 即 TaskGroupListItem），
 * 视图不复制任务或记录实体；CLOSED 组按服务端口径返回空 branches 与 null mainTask。
 */
export type MyTaskGroupItem = TaskGroupListItem;

export interface MyTaskGroupsResult {
  readonly items: readonly MyTaskGroupItem[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

export interface MyTaskGroupsQueryInput {
  /** 按项目范围筛选时传入当前项目；null 表示跨项目（服务端 AuthorizedProjectScope）。 */
  readonly projectId: number | null;
  readonly cursor: string | null;
}

export interface MyTaskListResult {
  readonly items: readonly MyTaskListItem[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
  /** R-3 未返回聚合统计；null 表示不可知，显示层不得虚构。 */
  readonly stats: MyTaskStats | null;
  readonly scopeCounts: Readonly<Record<MyTaskScope, number>> | null;
  readonly leftoverCount: number | null;
  readonly leftoverSample: MyTaskLeftoverSample | null;
  /** 适配器可表达的筛选维度；结果缺省时按完整能力处理。 */
  readonly filterSupport: MyTasksFilterSupport;
}

export interface MyTasksQueryInput {
  readonly filters: MyTaskFilters;
  readonly viewerId: number | null;
}

/** 数据源适配器；页面默认注入 server 实现，mock 只用于测试与降级演示。 */
export interface MyTasksAdapter {
  readonly source: "mock" | "server";
  readonly notice: string;
  fetchMyTasks(input: MyTasksQueryInput): Promise<MyTaskListResult>;
  /** R-7 聚合组列表（任务中心「任务聚合组」区块）；缺数据时返回空页而不是隐藏区块。 */
  fetchTaskGroups(input: MyTaskGroupsQueryInput): Promise<MyTaskGroupsResult>;
}
