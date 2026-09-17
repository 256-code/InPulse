import type { ProjectStatus } from "@generated/api";

import type { CalmBadgeTone } from "./components/Calm";

/**
 * 项目生命周期标签档位（ADR-035）：直接映射服务端存储的四态，判定与排序键
 * `apps/api/src/stats/card-stat-columns.ts` 的 `projectLifecycleRankExpression` 一致
 * （进行中 → 未开始 → 维护中 → 已归档），两处必须一起修改。
 *
 * - `ACTIVE`：进行中，项目已开工；
 * - `NOT_STARTED`：未开始，项目下还没有任何已完成任务；
 * - `MAINTENANCE`：维护中，主体已完成、只做小修小补且不打算归档；
 * - `ARCHIVED`：已归档，项目及其下级只读。
 */
export type ProjectLifecycleKind = ProjectStatus;

export const projectLifecycleKind = (
  status: ProjectStatus,
): ProjectLifecycleKind => status;

const projectLabels: Record<ProjectLifecycleKind, string> = {
  ACTIVE: "进行中",
  NOT_STARTED: "未开始",
  MAINTENANCE: "维护中",
  ARCHIVED: "已归档",
};

export const projectLifecycleLabel = (status: ProjectStatus): string =>
  projectLabels[projectLifecycleKind(status)];

/**
 * 项目标签配色：进行中沿用卡片原有主色（项目蓝），未开始用中性青与进行中区分，
 * 维护中用紫，已归档沿用琥珀，与列表卡片既有的 `card-archived` 视觉一致。
 */
export const projectLifecycleTone = (
  status: ProjectStatus,
  activeTone: CalmBadgeTone,
): CalmBadgeTone => {
  const kind = projectLifecycleKind(status);
  if (kind === "ARCHIVED") return "amber";
  if (kind === "NOT_STARTED") return "cyan";
  if (kind === "MAINTENANCE") return "violet";
  return activeTone;
};

/**
 * 模块与功能的生命周期标签档位。判定规则与后端排序键
 * `apps/api/src/stats/card-stat-columns.ts` 的 `lifecycleRankExpression` 完全一致，
 * 两处必须一起修改：
 *
 * - `ARCHIVED`：已归档，无论是否完成过任务，一律排在最后。
 * - `ACTIVE`：进行中，作用域内已有 `work_status = 'DONE'` 的有效任务。
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
  ACTIVE: "进行中",
  NOT_STARTED: "未开始",
  ARCHIVED: "已归档",
};

export const resourceLifecycleLabel = (
  status: "ACTIVE" | "ARCHIVED",
  completedTaskCount: number,
): string => labels[resourceLifecycleKind(status, completedTaskCount)];

/**
 * 标签配色：进行中沿用卡片原有主色（项目蓝、模块灰），未开始用中性青与进行中区分，
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
