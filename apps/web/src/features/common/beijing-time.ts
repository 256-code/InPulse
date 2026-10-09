/**
 * 全站时间展示统一按北京时间（Asia/Shanghai）渲染。
 *
 * 服务端下发的都是 UTC ISO 串。直接 `new Date(...).toLocaleString()` 或读
 * `getHours()` 会按运行环境时区渲染，在非 +8 时区会显示成另一天/另一时刻
 * （2026-10-09 06:23Z 在 UTC 机器上会原样显示成 06:23，而不是北京的 14:23）。
 * 凡是把服务端时间渲染给用户看的地方都必须走本模块，不得再用本地时区格式化；
 * 任务看板 `task-board-format.ts` 与「今天/本周/本月」口径也是同一基准。
 *
 * 例外：用户输入控件里的 `YYYY-MM-DDTHH:mm`（截止时间选择器）是浏览器本地墙上
 * 时间，与输入框往返一致，不在本模块内换算。
 */

export const BEIJING_TIME_ZONE = "Asia/Shanghai";

/**
 * Asia/Shanghai 没有夏令时，全年固定 +8 小时；从 UTC 时间戳换算北京日历日时
 * 直接减偏移即可，不需要走 `Intl`（也避免服务器/浏览器 ICU 差异）。
 */
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

const BEIJING_PARTS_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: BEIJING_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export interface BeijingDateTime {
  readonly year: number;
  /** 1-12。 */
  readonly month: number;
  /** 1-31。 */
  readonly day: number;
  /** 0-23。 */
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

const pad2 = (value: number): string => String(value).padStart(2, "0");

function readPart(
  parts: readonly Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): string {
  return parts.find((part) => part.type === type)?.value ?? "";
}

/** UTC ISO 串 → 北京时间年月日时分秒；非法输入或空值返回 null。 */
export function beijingDateTime(
  value: string | null | undefined,
): BeijingDateTime | null {
  if (value === null || value === undefined || value.trim() === "") {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  const parts = BEIJING_PARTS_FORMATTER.formatToParts(parsed);
  return {
    year: Number(readPart(parts, "year")),
    month: Number(readPart(parts, "month")),
    day: Number(readPart(parts, "day")),
    // 少数 ICU 在 hour12: false 下会把午夜渲染成 24，归一成 0 更稳。
    hour: Number(readPart(parts, "hour")) % 24,
    minute: Number(readPart(parts, "minute")),
    second: Number(readPart(parts, "second")),
  };
}

/** 北京日历日键 `YYYY-MM-DD`（与运行环境时区无关）。 */
export function beijingDayKey(value: string): string {
  const at = beijingDateTime(value);
  return at === null
    ? value.slice(0, 10)
    : at.year + "-" + pad2(at.month) + "-" + pad2(at.day);
}

/** `2026-10-09`。 */
export function formatBeijingDate(value: string): string {
  const at = beijingDateTime(value);
  return at === null
    ? value
    : at.year + "-" + pad2(at.month) + "-" + pad2(at.day);
}

/** `2026-10-09 14:23`。 */
export function formatBeijingMinute(value: string): string {
  const at = beijingDateTime(value);
  return at === null
    ? value
    : formatBeijingDate(value) + " " + pad2(at.hour) + ":" + pad2(at.minute);
}

/** `2026-10-09 14:23:45`。 */
export function formatBeijingSecond(value: string): string {
  const at = beijingDateTime(value);
  return at === null
    ? value
    : formatBeijingMinute(value) + ":" + pad2(at.second);
}

/** `10月9日`。 */
export function formatBeijingMonthDayCn(value: string): string {
  const at = beijingDateTime(value);
  return at === null ? value : at.month + "月" + at.day + "日";
}

/** `10/9`。 */
export function formatBeijingMonthDaySlash(value: string): string {
  const at = beijingDateTime(value);
  return at === null ? value : at.month + "/" + at.day;
}

/** `14:23`。 */
export function formatBeijingClock(value: string): string {
  const at = beijingDateTime(value);
  return at === null ? "" : pad2(at.hour) + ":" + pad2(at.minute);
}

/** `10/9 14:23`。 */
export function formatBeijingShortDateTime(value: string): string {
  const at = beijingDateTime(value);
  return at === null
    ? value
    : formatBeijingMonthDaySlash(value) + " " + formatBeijingClock(value);
}

/** 日期键 `2026-10-09` → `2026年10月9日`；不经过 Date，避免时区漂移。 */
export function formatDayKeyCn(key: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (match === null) {
    return key;
  }
  return (
    Number(match[1]) + "年" + Number(match[2]) + "月" + Number(match[3]) + "日"
  );
}

/** 日期键 `2026-10-09` → `10/9`；不经过 Date，避免时区漂移。 */
export function formatDayKeySlash(key: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (match === null) {
    return key;
  }
  return Number(match[2]) + "/" + Number(match[3]);
}

/**
 * 北京墙上时间 `YYYY-MM-DDTHH:mm`（可带 `:ss`，即 `datetime-local` 的取值）
 * → UTC ISO 串；格式非法或不是真实日历日返回 null。
 *
 * 审计筛选等「用户按看到的北京时间输入」的表单走这里，与列表展示同一口径。
 */
export function beijingWallClockToIso(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    value.trim(),
  );
  if (match === null) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] === undefined ? 0 : Number(match[6]);
  const utcMs =
    Date.UTC(year, month - 1, day, hour, minute, second) - BEIJING_OFFSET_MS;
  const check = new Date(utcMs + BEIJING_OFFSET_MS);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() + 1 !== month ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute
  ) {
    return null;
  }
  return new Date(utcMs).toISOString();
}

/** 北京日历日在 UTC 时间轴上的 0 点毫秒值。 */
function beijingDayStart(at: BeijingDateTime): number {
  return Date.UTC(at.year, at.month - 1, at.day) - BEIJING_OFFSET_MS;
}

function beijingNow(now: Date): BeijingDateTime {
  const at = beijingDateTime(now.toISOString());
  if (at === null) {
    throw new Error("无法把当前时刻换算成北京时间");
  }
  return at;
}

/** 北京「今天 0 点」的毫秒值。 */
export function beijingTodayStart(now: Date = new Date()): number {
  return beijingDayStart(beijingNow(now));
}

/** 服务端时间是否落在北京「今天 +/- offsetDays」这个日历日。 */
export function isBeijingSameDay(
  value: string,
  offsetDays: number,
  now: Date = new Date(),
): boolean {
  const at = beijingDateTime(value);
  if (at === null) {
    return false;
  }
  const today = beijingNow(now);
  const target = new Date(
    Date.UTC(today.year, today.month - 1, today.day + offsetDays),
  );
  return (
    at.year === target.getUTCFullYear() &&
    at.month === target.getUTCMonth() + 1 &&
    at.day === target.getUTCDate()
  );
}

export function isBeijingToday(value: string, now: Date = new Date()): boolean {
  return isBeijingSameDay(value, 0, now);
}

/** 服务端时间是否早于北京「今天 0 点」。 */
export function isBeijingBeforeToday(
  value: string,
  now: Date = new Date(),
): boolean {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }
  return parsed.getTime() < beijingTodayStart(now);
}

/** 是否落在「北京今天起 days 个日历日内」（含今天，不含第 days 天 0 点）。 */
export function isBeijingWithinNextDays(
  value: string,
  days: number,
  now: Date = new Date(),
): boolean {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }
  const start = beijingTodayStart(now);
  return (
    parsed.getTime() >= start && parsed.getTime() < start + days * 86_400_000
  );
}

/** 服务端时间是否落在北京「本月」。 */
export function isBeijingSameMonth(
  value: string,
  now: Date = new Date(),
): boolean {
  const at = beijingDateTime(value);
  if (at === null) {
    return false;
  }
  const today = beijingNow(now);
  return at.year === today.year && at.month === today.month;
}

/** 北京当前年月（本季度/本月预设用）。 */
export function beijingTodayParts(now: Date = new Date()): {
  readonly year: number;
  readonly month: number;
} {
  const today = beijingNow(now);
  return { year: today.year, month: today.month };
}
