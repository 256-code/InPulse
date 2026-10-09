/**
 * 任务中心时间口径：日历日一律按北京时间（Asia/Shanghai）比较与展示，
 * 与全站时间展示、服务端「按上海时间按日统计」保持同一自然日口径，
 * 避免直接比较时间戳（同一天的 09:00 与 23:00 会被误判为不同日）。
 */
import {
  beijingDateTime,
  formatBeijingMonthDayCn,
  isBeijingBeforeToday,
  isBeijingSameDay,
  isBeijingSameMonth,
  isBeijingToday,
  isBeijingWithinNextDays,
} from "@features/common/beijing-time";

export function isTodayIso(iso: string): boolean {
  return isBeijingToday(iso);
}

export function isSameDayIso(iso: string, offsetDays: number): boolean {
  return isBeijingSameDay(iso, offsetDays);
}

export function isBeforeTodayIso(iso: string): boolean {
  return isBeijingBeforeToday(iso);
}

/** 是否落在「今天起 days 个日历日内」的区间（含今天，不含第 days 天的 0 点）。 */
export function isWithinNextDaysIso(iso: string, days: number): boolean {
  return isBeijingWithinNextDays(iso, days);
}

export function isSameMonthIso(iso: string): boolean {
  return isBeijingSameMonth(iso);
}

export function formatDayIso(iso: string): string {
  return formatBeijingMonthDayCn(iso);
}

export function formatDateTimeIso(iso: string): string {
  const at = beijingDateTime(iso);
  if (at === null) {
    return iso;
  }
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    formatBeijingMonthDayCn(iso) + " " + pad(at.hour) + ":" + pad(at.minute)
  );
}
