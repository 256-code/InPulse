/**
 * 任务中心时间口径：一律按本地日历日比较与展示，
 * 避免直接比较时间戳（同一天的 09:00 与 23:00 会被误判为不同日）。
 */

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function isTodayIso(iso: string): boolean {
  return isSameDayIso(iso, 0);
}

export function isSameDayIso(iso: string, offsetDays: number): boolean {
  const now = new Date();
  const target = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + offsetDays,
  );
  const value = new Date(iso);
  return (
    value.getFullYear() === target.getFullYear() &&
    value.getMonth() === target.getMonth() &&
    value.getDate() === target.getDate()
  );
}

export function isBeforeTodayIso(iso: string): boolean {
  return new Date(iso).getTime() < startOfToday().getTime();
}

/** 是否落在「今天起 days 个日历日内」的区间（含今天，不含第 days 天的 0 点）。 */
export function isWithinNextDaysIso(iso: string, days: number): boolean {
  const start = startOfToday();
  const end = new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate() + days,
  );
  const value = new Date(iso).getTime();
  return value >= start.getTime() && value < end.getTime();
}

export function isSameMonthIso(iso: string): boolean {
  const now = new Date();
  const value = new Date(iso);
  return (
    value.getFullYear() === now.getFullYear() &&
    value.getMonth() === now.getMonth()
  );
}

export function formatDayIso(iso: string): string {
  const value = new Date(iso);
  return value.getMonth() + 1 + "月" + value.getDate() + "日";
}

export function formatDateTimeIso(iso: string): string {
  const value = new Date(iso);
  const hour = String(value.getHours()).padStart(2, "0");
  const minute = String(value.getMinutes()).padStart(2, "0");
  return formatDayIso(iso) + " " + hour + ":" + minute;
}
