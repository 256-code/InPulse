/**
 * 任务程度配色（优先级 / 完成状态 / 截止紧迫度）→ 卡片与列表共用的 tone 类名。
 *
 * 与 priority-select-option.ts 的优先级圆点色同源：紧急红 / 高明黄 / 普通蓝 /
 * 低灰，已完成绿、已取消灰；已逾期与马上到期另有两支红，都铺整张卡。
 * 色值分两处维护：design-system.css 中段的 .tone-prio-* 管列表行 / 表格行的浅色底
 * 与色条，「任务卡片醒目配色」块管卡片实色；优先级圆点取卡片实色的同值。
 * 任务看板（卡片 + 列表）、任务中心（卡片 + 列表）与功能任务面板共用同一
 * 映射，避免同一优先级在不同页面颜色不一。
 */
import type { CalmBadgeTone } from "./components/Calm";

export type TaskToneName =
  | "urgent"
  | "high"
  | "normal"
  | "low"
  | "done"
  | "canceled"
  | "overdue"
  | "soon";

/**
 * 优先级中文名：任务卡片、聚合组卡片与聚合组弹窗分支共用同一文案，
 * 避免同一优先级在不同展示位写法不一。未知值原样返回，只影响单个徽章。
 */
const PRIORITY_LABELS: Readonly<Record<string, string>> = {
  URGENT: "紧急",
  HIGH: "高",
  NORMAL: "普通",
  LOW: "低",
};

export function taskPriorityLabel(priority: string): string {
  return PRIORITY_LABELS[priority] ?? priority;
}

/**
 * 优先级徽章色调：CalmBadge 的 red/amber/blue/gray 与 .tone-prio-* 同源语义
 * （紧急红 / 高橙 / 普通蓝 / 低灰），未知优先级按「低」的中性灰处理。
 */
const PRIORITY_BADGE_TONES: Readonly<Record<string, CalmBadgeTone>> = {
  URGENT: "red",
  HIGH: "amber",
  NORMAL: "blue",
  LOW: "gray",
};

export function taskPriorityBadgeTone(priority: string): CalmBadgeTone {
  return PRIORITY_BADGE_TONES[priority] ?? "gray";
}

/**
 * 截止紧迫度，由调用方按各自口径判定后传入第三参数：
 * - 任务中心 / 项目任务面板：按 dueAt 与当地日历日比较（已过期 / 今天到期）；
 * - 任务看板：只读服务端 dueState（OVERDUE / TODAY），不在前端按本地时钟重算。
 * 「明天到期」与更远的日期都不进档，避免整卡红提前出现。
 */
export type TaskDueTone = "overdue" | "soon";

/**
 * 完成态覆盖一切：已完成整卡 / 整行转绿，已取消转灰；
 * 未完成时截止紧迫度覆盖优先级——已逾期整卡深红、马上到期整卡橙红；
 * 其余按优先级取色，未知优先级按「低」的中性灰处理。
 */
export function taskToneOf(
  priority: string,
  workStatus: string,
  dueTone: TaskDueTone | null = null,
): TaskToneName {
  if (workStatus === "DONE") return "done";
  if (workStatus === "CANCELED") return "canceled";
  if (dueTone === "overdue") return "overdue";
  if (dueTone === "soon") return "soon";
  switch (priority) {
    case "URGENT":
      return "urgent";
    case "HIGH":
      return "high";
    case "NORMAL":
      return "normal";
    default:
      return "low";
  }
}

/** 卡片 / 整行的程度配色类名；与 design-system.css 的 .tone-prio-* 一一对应。 */
export function taskToneClassName(
  priority: string,
  workStatus: string,
  dueTone: TaskDueTone | null = null,
): string {
  return "tone-prio-" + taskToneOf(priority, workStatus, dueTone);
}
