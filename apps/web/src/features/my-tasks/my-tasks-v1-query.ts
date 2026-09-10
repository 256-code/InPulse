import type {
  MyTaskFilters,
  MyTaskLevel,
  MyTaskWorkStatus,
} from "./my-tasks-types";

/**
 * R-3 listMyTasks 的 A 岗冻结契约映射（F-32 任务中心）。
 *
 * 冻结事实见 docs/a-contract-review-f25-f29-f32.md §2、§3、Q-08 ~ Q-10：
 * 路径 GET /api/v1/me/tasks，参数只允许 cursor / limit / projectId /
 * scopeType / workStatus / hasPublishedRecord，负责人固定为当前用户，
 * 排序固定 id DESC，limit 默认 20、上限 100。
 *
 * 本文件只做「UI 筛选状态 → 冻结查询参数」的纯映射与缺口盘点：不发起请求、
 * 不引入生成客户端、不登记路由。按裁决 §7，登记与生成物必须与实现同一个 PR
 * 落库；在那之前本文件不是路由契约来源，骨架数据仍由 mock adapter 提供。
 */

export const MY_TASKS_V1_PATH = "/api/v1/me/tasks";
export const MY_TASKS_V1_LIMIT_DEFAULT = 20;
export const MY_TASKS_V1_LIMIT_MAX = 100;

/** 冻结的 R-3 查询参数；未赋值的键表示不发送该参数。 */
export interface MyTasksV1Query {
  readonly cursor?: string;
  readonly limit?: number;
  readonly projectId?: number;
  readonly scopeType?: MyTaskLevel;
  readonly workStatus?: MyTaskWorkStatus;
  readonly hasPublishedRecord?: boolean;
}

export interface MyTasksV1QueryOptions {
  /** 上一页返回的签名游标；null 或空串表示首页。 */
  readonly cursor?: string | null;
  /** 每页条数；非正整数回退默认值，超过上限按上限收口。 */
  readonly limit?: number;
}

/**
 * UI 筛选面相对冻结契约的缺口（参数维度）。
 *
 * 这些筛选在设计师稿与骨架 UI 中存在，但 R-3 的冻结参数无法表达；
 * 接线时必须显式降级（隐藏或标注「后续迭代」），不得静默忽略，
 * 也不得把未登记的参数提前写进请求。
 */
export type MyTasksV1FilterGap =
  | "scope:created"
  | "scope:all"
  | "scope:project-without-id"
  | "filter:priority"
  | "filter:relation"
  | "filter:github"
  | "filter:query"
  | "filter:canceled-with-open";

/**
 * 骨架列表项相对冻结 DTO 的缺口（字段维度）。
 *
 * docs/c-aggregate-read-contract-proposal.md 的 R-3 项没有这些字段，
 * 设计稿的优先级徽章、截止时间与记录数依赖它们，属待裁定项。
 */
export const MY_TASKS_V1_MISSING_ITEM_FIELDS = [
  "priority",
  "dueAt",
  "completedAt",
  "description",
  "creatorId",
  "githubLinkCount",
] as const;

/**
 * 响应维度的缺口：R-3 只返回 items / nextCursor / hasMore，
 * 统计卡片、各范围计数与遗留问题入口没有契约来源。
 */
export const MY_TASKS_V1_MISSING_RESPONSE_PARTS = [
  "stats",
  "scopeCounts",
  "leftoverCount",
  "leftoverSample",
] as const;

/** 取「未完成」时是否要求把已取消任务一并计入（workStatus 单值无法表达并集）。 */
export function requiresCanceledUnion(filters: MyTaskFilters): boolean {
  return filters.status === "open" && filters.includeCanceled;
}

/** status=all 不带 workStatus；open 与 done 映射为单值。 */
export function toMyTasksV1WorkStatus(
  filters: MyTaskFilters,
): MyTaskWorkStatus | null {
  if (filters.status === "open") return "TODO";
  if (filters.status === "done") return "DONE";
  return null;
}

/** 非正整数回退默认值，超过上限按上限收口，与服务端 422 边界保持一致。 */
export function clampMyTasksV1Limit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1) return MY_TASKS_V1_LIMIT_DEFAULT;
  return Math.min(limit, MY_TASKS_V1_LIMIT_MAX);
}

export function toMyTasksV1Query(
  filters: MyTaskFilters,
  options: MyTasksV1QueryOptions = {},
): MyTasksV1Query {
  const query: {
    cursor?: string;
    limit: number;
    projectId?: number;
    scopeType?: MyTaskLevel;
    workStatus?: MyTaskWorkStatus;
    hasPublishedRecord?: boolean;
  } = {
    limit: clampMyTasksV1Limit(options.limit ?? MY_TASKS_V1_LIMIT_DEFAULT),
  };

  const cursor = options.cursor ?? null;
  if (cursor !== null && cursor.length > 0) query.cursor = cursor;
  if (filters.scope === "project" && filters.projectId !== null) {
    query.projectId = filters.projectId;
  }
  if (filters.level !== null) query.scopeType = filters.level;
  const workStatus = toMyTasksV1WorkStatus(filters);
  if (workStatus !== null) query.workStatus = workStatus;
  if (filters.hasRecord !== null) {
    query.hasPublishedRecord = filters.hasRecord === "yes";
  }
  return query;
}

/**
 * 列出当前筛选状态下 V1 无法表达的项；空数组表示可完整映射。
 * 调用方应在接线时据此决定 UI 降级，不得把缺口当作已实现能力。
 */
export function listMyTasksV1Gaps(
  filters: MyTaskFilters,
): readonly MyTasksV1FilterGap[] {
  const gaps: MyTasksV1FilterGap[] = [];
  if (filters.scope === "created") gaps.push("scope:created");
  if (filters.scope === "all") gaps.push("scope:all");
  if (filters.scope === "project" && filters.projectId === null) {
    gaps.push("scope:project-without-id");
  }
  if (filters.priority !== null) gaps.push("filter:priority");
  if (filters.relation !== null) gaps.push("filter:relation");
  if (filters.hasGithub !== null) gaps.push("filter:github");
  if (filters.query.trim().length > 0) gaps.push("filter:query");
  if (requiresCanceledUnion(filters)) gaps.push("filter:canceled-with-open");
  return gaps;
}
