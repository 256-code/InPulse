import type { ProjectStatus } from "@generated/api";

import type { CalmBadgeTone } from "./components/Calm";

/**
 * 项目生命周期标签档位（ADR-043）：直接映射服务端存储的三态，判定与排序键
 * `apps/api/src/stats/card-stat-columns.ts` 的 `projectLifecycleRankExpression` 一致
 * （进行中 → 未开始 → 维护中），两处必须一起修改。
 * 项目层面已下线归档，不再有「已归档」档位。
 *
 * - `ACTIVE`：进行中，项目已开工；
 * - `NOT_STARTED`：未开始，项目下还没有任何已完成任务；
 * - `MAINTENANCE`：维护中，主体已完成、只做小修小补；
 *   切到维护中要求项目下任务全部收尾，否则服务端 409。
 */
export type ProjectLifecycleKind = ProjectStatus;

export const projectLifecycleKind = (
  status: ProjectStatus,
): ProjectLifecycleKind => status;

const projectLabels: Record<ProjectLifecycleKind, string> = {
  ACTIVE: "进行中",
  NOT_STARTED: "未开始",
  MAINTENANCE: "维护中",
};

export const projectLifecycleLabel = (status: ProjectStatus): string =>
  projectLabels[projectLifecycleKind(status)];

/**
 * 项目标签配色：「进行中」全站统一项目蓝，未开始用中性青与进行中区分，维护中用紫。
 */
export const projectLifecycleTone = (
  status: ProjectStatus,
  activeTone: CalmBadgeTone,
): CalmBadgeTone => {
  const kind = projectLifecycleKind(status);
  if (kind === "NOT_STARTED") return "cyan";
  if (kind === "MAINTENANCE") return "violet";
  return activeTone;
};

/**
 * 模块生命周期标签档位（ADR-044）：模块层面已下线归档，档位只由「模块下是否已有
 * 完成任务」推导，与后端排序键 `apps/api/src/stats/card-stat-columns.ts` 的
 * `lifecycleRankExpression` 在模块侧的输出一致（0 = 进行中、1 = 未开始），两处必须一起修改：
 *
 * - `ACTIVE`：进行中，模块下已有 `work_status = 'DONE'` 的有效任务。
 * - `NOT_STARTED`：未开始，模块下还没有任何已完成任务。
 *
 * 功能自 ADR-045 起同样下线归档，档位按同一规则推导，见下方功能档位。
 */
export type ModuleLifecycleKind = "ACTIVE" | "NOT_STARTED";

export const moduleLifecycleKind = (
  completedTaskCount: number,
): ModuleLifecycleKind => (completedTaskCount > 0 ? "ACTIVE" : "NOT_STARTED");

const moduleLabels: Record<ModuleLifecycleKind, string> = {
  ACTIVE: "进行中",
  NOT_STARTED: "未开始",
};

export const moduleLifecycleLabel = (completedTaskCount: number): string =>
  moduleLabels[moduleLifecycleKind(completedTaskCount)];

/**
 * 模块标签配色：「进行中」全站统一项目蓝（与项目、功能列表卡同色），
 * 未开始用中性青与进行中区分。第三个参数是「进行中」档位的主色，
 * 按「同一文案同色」的规则，调用方必须传 `blue`。
 */
export const moduleLifecycleTone = (
  completedTaskCount: number,
  activeTone: CalmBadgeTone,
): CalmBadgeTone =>
  moduleLifecycleKind(completedTaskCount) === "NOT_STARTED"
    ? "cyan"
    : activeTone;

/**
 * 功能生命周期标签档位（ADR-045）：功能层面已下线归档，档位只由「功能下是否已有
 * 完成任务」推导，与后端排序键 `apps/api/src/stats/card-stat-columns.ts` 的
 * `lifecycleRankExpression` 在功能侧的输出一致（0 = 进行中、1 = 未开始），两处必须一起修改：
 *
 * - `ACTIVE`：进行中，功能下已有 `work_status = 'DONE'` 的有效任务。
 * - `NOT_STARTED`：未开始，功能下还没有任何已完成任务。
 */
export type FeatureLifecycleKind = "ACTIVE" | "NOT_STARTED";

export const featureLifecycleKind = (
  completedTaskCount: number,
): FeatureLifecycleKind => (completedTaskCount > 0 ? "ACTIVE" : "NOT_STARTED");

const featureLabels: Record<FeatureLifecycleKind, string> = {
  ACTIVE: "进行中",
  NOT_STARTED: "未开始",
};

export const featureLifecycleLabel = (completedTaskCount: number): string =>
  featureLabels[featureLifecycleKind(completedTaskCount)];

/**
 * 功能标签配色：与项目、模块列表卡一致——未开始用中性青，进行中用主色。
 * 按「同一文案同色」的规则，调用方必须传 `blue`。
 */
export const featureLifecycleTone = (
  completedTaskCount: number,
  activeTone: CalmBadgeTone,
): CalmBadgeTone =>
  featureLifecycleKind(completedTaskCount) === "NOT_STARTED"
    ? "cyan"
    : activeTone;
