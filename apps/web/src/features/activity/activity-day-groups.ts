import type { ActivityItem } from "@generated/api";

/** 动态日期键与列表分组共用本地时区，避免组头日期与行内时刻跨零点错位。 */
export function activityDayKey(occurredAt: string) {
  const parsed = new Date(occurredAt);
  if (Number.isNaN(parsed.getTime())) {
    return occurredAt.slice(0, 10);
  }
  return [
    parsed.getFullYear(),
    String(parsed.getMonth() + 1).padStart(2, "0"),
    String(parsed.getDate()).padStart(2, "0"),
  ].join("-");
}

function activityDayDate(key: string) {
  return new Date(`${key}T00:00:00`);
}

function activityDayLabel(key: string) {
  const date = activityDayDate(key);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString("zh-CN", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : key;
}

/** 时间线竖线左侧的短日期（如 9/24），完整日期仍由分组标题承载。 */
export function activityDayShortLabel(key: string) {
  const date = activityDayDate(key);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })
    : key;
}

/** 分组内每条动态对应的时刻（如 14:59），日期由组头承担。 */
export function activityTimeLabel(occurredAt: string) {
  const date = new Date(occurredAt);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return [
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
  ].join(":");
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
