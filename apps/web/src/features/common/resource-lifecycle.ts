import type { CalmBadgeTone } from "./components/Calm";

/**
 * 项目与模块的生命周期标签档位。判定规则与后端排序键
 * `apps/api/src/stats/card-stat-columns.ts` 的 `lifecycleRankExpression` 完全一致，
 * 两处必须一起修改：
 *
 * - `ARCHIVED`：已归档，无论是否完成过任务，一律排在最后。
 * - `ACTIVE`：正常，作用域内已有 `work_status = 'DONE'` 的有效任务。
 * - `NOT_STARTED`：未开始，作用域内还没有任何已完成任务。
 */
export type ResourceLifecycleKind = "ACTIVE" | "NOT_STARTED" | "ARCHIVED";

export const resourceLifecycleKind = (
  status: "ACTIVE" | "ARCHIVED",
  completedTaskCount: number,
): ResourceLifecycleKind => {
  if (status === "ARCHIVED") return "ARCHIVED";
  return completedTaskCount > 0 ? "ACTIVE" : "NOT_STARTED";
};

const labels: Record<ResourceLifecycleKind, string> = {
  ACTIVE: "正常",
  NOT_STARTED: "未开始",
  ARCHIVED: "已归档",
};

export const resourceLifecycleLabel = (
  status: "ACTIVE" | "ARCHIVED",
  completedTaskCount: number,
): string => labels[resourceLifecycleKind(status, completedTaskCount)];

/**
 * 标签配色：正常沿用卡片原有主色（项目蓝、模块灰），未开始用中性青与正常区分，
 * 已归档沿用琥珀，与列表卡片既有的 `card-archived` 视觉一致。
 */
export const resourceLifecycleTone = (
  status: "ACTIVE" | "ARCHIVED",
  completedTaskCount: number,
  activeTone: CalmBadgeTone,
): CalmBadgeTone => {
  const kind = resourceLifecycleKind(status, completedTaskCount);
  if (kind === "ARCHIVED") return "amber";
  if (kind === "NOT_STARTED") return "cyan";
  return activeTone;
};
