/**
 * 任务程度配色（优先级 / 完成状态 / 遗留来源）→ 卡片与列表共用的 tone 类名。
 *
 * 与 priority-select-option.ts 的优先级圆点色同源（2026-09-23 二次定案「高改蓝、普通改白」，
 * 同日三次定案把「高」改成产品给的金黄 #fdc106）：
 * 紧急红 / 高金 / 普通白（白底卡配中性灰圆点），已完成青碧、已取消灰；遗留问题来源整卡锈红。
 * 截止紧迫度（已逾期 / 今天到期）不参与卡片配色——2026-09-22 产品口径
 * 「逾期的不搞特殊了，原本的优先级是什么就呈现什么颜色，只是排序靠前，比紧急低一档」：
 * 逾期只在两处体现，一是服务端排序（见 apps/api/src/modules/tasks/task-list-order.ts
 * 的 urgency 桶「遗留问题 → 标记紧急 → 已逾期 → 今/明日截止 → 其余」），
 * 二是白底表面的红色日期文案（design-system.css 的 .due-overdue / .due-soon 与
 * .tb-date--overdue / .tb-date--today），不再整卡换色。
 * 色值分两处维护：design-system.css 中段的 .tone-prio-* 管列表行 / 表格行的浅色底
 * 与色条，「任务卡片醒目配色」块管卡片实色；优先级圆点取卡片实色的同值。
 * 任务看板（卡片 + 列表）、任务中心（卡片 + 列表）与功能任务面板共用同一
 * 映射，避免同一优先级在不同页面颜色不一。
 */
import type { CalmBadgeTone } from "./components/Calm";

export type TaskToneName =
  "urgent" | "high" | "normal" | "done" | "canceled" | "leftover";

/**
 * 优先级中文名：任务卡片、聚合组卡片与聚合组弹窗分支共用同一文案，
 * 避免同一优先级在不同展示位写法不一。未知值原样返回，只影响单个徽章。
 */
const PRIORITY_LABELS: Readonly<Record<string, string>> = {
  URGENT: "紧急",
  HIGH: "高",
  NORMAL: "普通",
};

export function taskPriorityLabel(priority: string): string {
  return PRIORITY_LABELS[priority] ?? priority;
}

/**
 * 优先级徽章色调：CalmBadge 的 red/amber/gray 与 .tone-prio-* 同源语义
 * （紧急红 / 高金（amber 色阶）/ 普通灰——「普通」是白底卡，徽章取中性灰才与卡片同一调性），
 * 未知优先级按中性灰处理。
 */
const PRIORITY_BADGE_TONES: Readonly<Record<string, CalmBadgeTone>> = {
  URGENT: "red",
  HIGH: "amber",
  NORMAL: "gray",
};

export function taskPriorityBadgeTone(priority: string): CalmBadgeTone {
  return PRIORITY_BADGE_TONES[priority] ?? "gray";
}

/**
 * 截止紧迫度，由调用方按各自口径判定后使用：
 * - 任务中心 / 项目任务面板：按 dueAt 与当地日历日比较（已过期 / 今天到期）；
 * - 任务看板：只读服务端 dueState（OVERDUE / TODAY），不在前端按本地时钟重算。
 * 「明天到期」与更远的日期都不进档。它现在只驱动日期文字色，不再决定卡片 tone。
 */
export type TaskDueTone = "overdue" | "soon";

/**
 * 完成态覆盖一切：已完成整卡 / 整行转青碧，已取消转灰；
 * 未完成时紧急仍是紧急红；其余由遗留问题来源覆盖成整卡锈红（看第 3 个参数）；
 * 再其余按优先级取色，未知优先级按「普通」处理（2026-09-23 起「低」档位已下线）。
 *
 * 截止紧迫度（已逾期 / 今天到期）不再是覆盖档：2026-09-22 产品要求「逾期的不搞特殊了，
 * 原本的优先级是什么就呈现什么颜色」，卡片只表达任务自己的优先级身份；
 * 逾期靠排序靠前 + 日期文案提示，见上面的 TaskDueTone 说明。
 *
 * 第三个参数 hasLeftoverSource（2026-09-22 产品要求「遗留问题整个卡片都要是红色的」）：
 * 由遗留项转换而来的任务整卡铺深锈红 `#8a2b06`（与「遗留问题」徽章同色系），
 * 让它在同屏里一眼可辨；已完成 / 已取消 / 紧急三档仍优先——完成态与真正的优先级身份
 * 都不该被来源标记盖掉。
 */
export function taskToneOf(
  priority: string,
  workStatus: string,
  hasLeftoverSource = false,
): TaskToneName {
  if (workStatus === "DONE") return "done";
  if (workStatus === "CANCELED") return "canceled";
  if (priority === "URGENT") return "urgent";
  if (hasLeftoverSource) return "leftover";
  switch (priority) {
    case "HIGH":
      return "high";
    default:
      return "normal";
  }
}

/** 卡片 / 整行的程度配色类名；与 design-system.css 的 .tone-prio-* 一一对应。 */
export function taskToneClassName(
  priority: string,
  workStatus: string,
  hasLeftoverSource = false,
): string {
  return "tone-prio-" + taskToneOf(priority, workStatus, hasLeftoverSource);
}
