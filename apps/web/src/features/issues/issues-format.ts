import type { LeftoverListItem } from "@generated/api";
import { formatBeijingDate } from "@features/common/beijing-time";

/** 遗留问题页展示口径：日期按北京时间日历日，不直接暴露 ISO 时间串。 */
export function formatIssueDate(value: string): string {
  return formatBeijingDate(value);
}

/** 来源行：来自「记录标题」 · 项目 / 模块 / 功能 · 作者 · 日期。 */
export function issueOriginText(item: LeftoverListItem): string {
  const scope = [
    item.projectName,
    item.moduleName,
    ...(item.featureName === null ? [] : [item.featureName]),
  ].join(" / ");
  return (
    "来自「" +
    item.recordTitle +
    "」 · " +
    scope +
    " · " +
    item.author.name +
    " · " +
    formatIssueDate(item.publishedAt)
  );
}

/** 已闭环 = 已转为跟进任务（CONVERTED）或已标记解决（RESOLVED）。 */
export function isLeftoverClosed(item: LeftoverListItem): boolean {
  return item.status !== "ACTIVE";
}
