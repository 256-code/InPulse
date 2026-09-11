import type { MyTaskItem } from "@generated/api";
import type {
  MyTaskFilters,
  MyTaskLevel,
  MyTaskListItem,
  MyTaskPriority,
  MyTasksFilterGap,
  MyTasksFilterSupport,
  MyTaskWorkStatus,
} from "./my-tasks-types";

/**
 * R-3 listMyTasks 的 A 岗冻结契约映射（F-32 任务中心）。
 *
 * 冻结事实见 docs/a-contract-review-f25-f29-f32.md §2、§3、§10、§11：
 * 路径 GET /api/v1/me/tasks，参数支持 cursor / limit / projectId /
 * scopeType / workStatus / hasPublishedRecord / priority / includeCanceled，
 * 负责人固定为当前用户，排序固定 id DESC，limit 默认 20、上限 100。
 *
 * 本文件只做「UI 筛选状态 → 冻结查询参数」的纯映射、R-3 条目映射与缺口盘点：
 * 不发起请求、不引入生成客户端实现、不改契约。请求由 my-tasks-server.ts
 * 经生成客户端发起；mock adapter 只保留用于前端测试与降级演示。
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
  /** 单值优先级筛选；与 workStatus 正交（A 裁决 §10.3）。 */
  readonly priority?: MyTaskPriority;
  /** 与 workStatus=TODO 组合表达「未完成并含已取消」（A 裁决 §10.3）。 */
  readonly includeCanceled?: boolean;
}

export interface MyTasksV1QueryOptions {
  /** 上一页返回的签名游标；null 或空串表示首页。 */
  readonly cursor?: string | null;
  /** 每页条数；非正整数回退默认值，超过上限按上限收口。 */
  readonly limit?: number;
}

/** 兼容别名：缺口类型定义在 my-tasks-types.ts，供适配器能力表复用。 */
export type MyTasksV1FilterGap = MyTasksFilterGap;

/**
 * R-3 契约对各项 UI 筛选的表达能力：第二轮扩展后 priority 与
 * 「未完成并含已取消」可由参数表达；其余 6 项仍无契约来源
 * （见 docs/a-contract-review-f25-f29-f32.md §3、§10 与 Q-08 ~ Q-10），
 * 服务端适配器按本表显式降级。
 */
export const MY_TASKS_V1_FILTER_SUPPORT: MyTasksFilterSupport = {
  "scope:created": false,
  "scope:all": false,
  "scope:project-without-id": false,
  "filter:priority": true,
  "filter:relation": false,
  "filter:github": false,
  "filter:query": false,
  "filter:canceled-with-open": true,
};

/**
 * 骨架列表项相对冻结 DTO 的缺口（字段维度）。
 *
 * 第二轮扩展后仅剩 description（A 裁决暂缓）；映射层保持 undefined，
 * 显示层不得展示描述。
 */
export const MY_TASKS_V1_MISSING_ITEM_FIELDS = ["description"] as const;

/**
 * 响应维度的缺口：第二轮扩展后 stats / leftoverCount / leftoverSample
 * 已由 R-3 提供；scopeCounts 为 A 裁决 §10.3 延后项，保持 null。
 */
export const MY_TASKS_V1_MISSING_RESPONSE_PARTS = ["scopeCounts"] as const;

/** 取「未完成」时是否要求把已取消任务一并计入（映射为 includeCanceled=true）。 */
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
    priority?: MyTaskPriority;
    includeCanceled?: boolean;
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
  if (filters.priority !== null) query.priority = filters.priority;
  if (requiresCanceledUnion(filters)) query.includeCanceled = true;
  return query;
}

/**
 * 无损映射 R-3 条目到骨架视图；仅 description 无契约来源保持 undefined，
 * 显示层据此显式降级（见 MY_TASKS_V1_MISSING_ITEM_FIELDS）。
 */
export function fromV1MyTaskItem(item: MyTaskItem): MyTaskListItem {
  return {
    taskId: item.taskId,
    code: item.code,
    title: item.title,
    projectId: item.projectId,
    projectName: item.projectName,
    moduleId: item.moduleId,
    moduleName: item.moduleName,
    featureId: item.featureId,
    featureName: item.featureName,
    scopeType: item.scopeType,
    workStatus: item.workStatus,
    lifecycleStatus: item.lifecycleStatus,
    updatedAt: item.updatedAt,
    assignee: {
      userId: item.assignee.userId,
      name: item.assignee.name,
      avatarUrl: item.assignee.avatarUrl,
    },
    priority: item.priority,
    dueAt: item.dueAt,
    completedAt: item.completedAt,
    creatorId: item.creatorId,
    githubLinkCount: item.githubLinkCount,
    hasPublishedRecord: item.hasPublishedRecord,
    publishedRecordCount: item.publishedRecordCount,
    groupRole: item.groupRole,
    groupId: item.groupId,
  };
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
  if (filters.relation !== null) gaps.push("filter:relation");
  if (filters.hasGithub !== null) gaps.push("filter:github");
  if (filters.query.trim().length > 0) gaps.push("filter:query");
  return gaps;
}
