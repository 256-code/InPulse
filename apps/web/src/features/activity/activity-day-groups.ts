import type { ActivityItem } from "@generated/api";

/**
 * Asia/Shanghai 无夏令时，固定 +8 小时就够了；这里与服务端的按日统计
 * （`occurred_at AT TIME ZONE 'Asia/Shanghai'`）保持同一自然日口径，
 * 否则日期旁的服务端计数会与归组结果错开一天。
 */
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

function shanghaiTime(occurredAt: string): Date | null {
  const parsed = new Date(occurredAt);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return new Date(parsed.getTime() + SHANGHAI_OFFSET_MS);
}

/** 日期键用上海时间（如 `2026-09-24`），与 Date 的本地时区无关。 */
export function activityDayKey(occurredAt: string) {
  const shifted = shanghaiTime(occurredAt);
  return shifted === null
    ? occurredAt.slice(0, 10)
    : shifted.toISOString().slice(0, 10);
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

/** 分组内每条动态对应的时刻（如 14:59，上海时间），日期由组头承担。 */
export function activityTimeLabel(occurredAt: string) {
  const shifted = shanghaiTime(occurredAt);
  if (shifted === null) {
    return "";
  }
  return [
    String(shifted.getUTCHours()).padStart(2, "0"),
    String(shifted.getUTCMinutes()).padStart(2, "0"),
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
