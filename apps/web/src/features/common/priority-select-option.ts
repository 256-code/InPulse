/**
 * 优先级 → CalmSelect 圆点配色：与 CalmBadge 的 gray/blue/amber/red 语义一致，
 * 供任务看板、任务中心、新建/编辑任务与遗留问题转换等优先级下拉共用，
 * 避免各处自行配色导致「紧急」在不同页面颜色不一。
 * 2026-09-21 起取值跟随任务卡片实色配色（design-system.css 末尾「任务卡片醒目配色」）：
 * 2026-09-22 随卡片定色口径一起更新为普通 #337ee6，低保持中性灰 #a0adb9；
 * 同日再按产品在红档样板里选定的「取中」把紧急从 #e84138 改成 #ce342b
 * （同底色白字对比度 4.00:1 → 5.09:1）；
 * 「高」的卡片是明黄底 #ffdb4d，8px 圆点压在白底弹层里会看不见，因此圆点取同色的深版 #8a6e00。
 */
const PRIORITY_DOT_COLORS: Readonly<Record<string, string>> = {
  URGENT: "#ce342b",
  HIGH: "#8a6e00",
  NORMAL: "#337ee6",
  LOW: "#a0adb9",
};

/** 未知优先级按「低」的中性灰处理，保证只影响单个选项而不整页崩溃。 */
export function priorityDotColor(priority: string): string {
  return PRIORITY_DOT_COLORS[priority] ?? "#a0adb9";
}
