import type { ActivityItem } from "@generated/api";
import {
  beijingDayKey,
  formatBeijingClock,
  formatDayKeyCn,
  formatDayKeySlash,
} from "@features/common/beijing-time";

/**
 * 归组与服务端的按日统计（`occurred_at AT TIME ZONE 'Asia/Shanghai'`）保持同一自然日口径，
 * 否则日期旁的服务端计数会与归组结果错开一天。
 */

/** 日期键用北京日历日（如 `2026-09-24`），与 Date 的本地时区无关。 */
export function activityDayKey(occurredAt: string) {
  return beijingDayKey(occurredAt);
}

function activityDayLabel(key: string) {
  return formatDayKeyCn(key);
}

/** 时间线竖线左侧的短日期（如 9/24），完整日期仍由分组标题承载。 */
export function activityDayShortLabel(key: string) {
  return formatDayKeySlash(key);
}

/** 分组内每条动态对应的时刻（如 14:59，北京时间），日期由组头承担。 */
export function activityTimeLabel(occurredAt: string) {
  return formatBeijingClock(occurredAt);
}

/** 服务端已按 occurred_at DESC 分页；这里只把当前已加载页按自然日分组。 */
export function groupActivitiesByDay(items: readonly ActivityItem[]) {
  const groups = new Map<string, ActivityItem[]>();
  for (const item of items) {
    const key = activityDayKey(item.occurredAt);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return Array.from(groups.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, grouped]) => ({
      key,
      label: activityDayLabel(key),
      shortLabel: activityDayShortLabel(key),
      items: grouped,
    }));
}
