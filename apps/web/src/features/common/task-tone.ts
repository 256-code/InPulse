/**
 * 任务程度配色（优先级 / 完成状态）→ 卡片与列表共用的 tone 类名。
 *
 * 与 priority-select-option.ts 的优先级圆点色同源：紧急红 / 高橙 / 普通蓝 /
 * 低灰，已完成绿、已取消灰；色值只在 design-system.css 的 .tone-prio-* 维护。
 * 任务看板（卡片 + 列表）、任务中心（卡片 + 列表）与功能任务面板共用同一
 * 映射，避免同一优先级在不同页面颜色不一。
 */
export type TaskToneName =
  | "urgent"
  | "high"
  | "normal"
  | "low"
  | "done"
  | "canceled";

/**
 * 完成态覆盖优先级：已完成整卡/整行转绿，已取消转灰；
 * 未完成按优先级取色，未知优先级按「低」的中性灰处理。
 */
export function taskToneOf(priority: string, workStatus: string): TaskToneName {
  if (workStatus === "DONE") return "done";
  if (workStatus === "CANCELED") return "canceled";
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
): string {
  return "tone-prio-" + taskToneOf(priority, workStatus);
}
