/**
 * 优先级 → CalmSelect 圆点配色：与 CalmBadge 的 gray/blue/amber/red 语义一致，
 * 供任务看板、任务中心、新建/编辑任务与遗留问题转换等优先级下拉共用，
 * 避免各处自行配色导致「紧急」在不同页面颜色不一。
 */
const PRIORITY_DOT_COLORS: Readonly<Record<string, string>> = {
  URGENT: "#c0453f",
  HIGH: "#c9821a",
  NORMAL: "#1467d8",
  LOW: "#a0adb9",
};

/** 未知优先级按「低」的中性灰处理，保证只影响单个选项而不整页崩溃。 */
export function priorityDotColor(priority: string): string {
  return PRIORITY_DOT_COLORS[priority] ?? "#a0adb9";
}
