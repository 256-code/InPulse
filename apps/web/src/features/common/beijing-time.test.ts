import { describe, expect, it } from "vitest";
import {
  beijingDateTime,
  beijingDayKey,
  beijingWallClockToIso,
  formatBeijingClock,
  formatBeijingDate,
  formatBeijingMinute,
  formatBeijingMonthDayCn,
  formatBeijingMonthDaySlash,
  formatBeijingSecond,
  formatBeijingShortDateTime,
  formatDayKeyCn,
  formatDayKeySlash,
} from "./beijing-time";

/**
 * 服务端下发 UTC ISO 串，展示必须固定按 Asia/Shanghai 渲染：
 * 期望值全部写死，避免测试机器时区不是 +8 时「本地时区实现」也能假通过。
 */

describe("北京时间展示", () => {
  const iso = "2026-10-09T06:23:45.000Z";

  it("按北京时间渲染各档位文案", () => {
    expect(formatBeijingDate(iso)).toBe("2026-10-09");
    expect(formatBeijingMinute(iso)).toBe("2026-10-09 14:23");
    expect(formatBeijingSecond(iso)).toBe("2026-10-09 14:23:45");
    expect(formatBeijingMonthDayCn(iso)).toBe("10月9日");
    expect(formatBeijingMonthDaySlash(iso)).toBe("10/9");
    expect(formatBeijingClock(iso)).toBe("14:23");
    expect(formatBeijingShortDateTime(iso)).toBe("10/9 14:23");
    expect(beijingDateTime(iso)).toEqual({
      year: 2026,
      month: 10,
      day: 9,
      hour: 14,
      minute: 23,
      second: 45,
    });
  });

  it("跨日边界按北京日历日归组，而不是直接切 UTC 串", () => {
    // 16:30Z = 北京次日 00:30：切字符串会归到 10-08，北京口径是 10-09。
    expect(beijingDayKey("2026-10-08T16:30:00.000Z")).toBe("2026-10-09");
    expect(beijingDayKey("2026-10-08T15:59:00.000Z")).toBe("2026-10-08");
  });

  it("日期键文案不经过 Date，不受运行环境时区影响", () => {
    expect(formatDayKeyCn("2026-10-09")).toBe("2026年10月9日");
    expect(formatDayKeySlash("2026-10-09")).toBe("10/9");
    expect(formatDayKeyCn("不是日期")).toBe("不是日期");
  });

  it("非法输入原样返回，不抛错", () => {
    expect(beijingDateTime("不是日期")).toBeNull();
    expect(beijingDateTime("")).toBeNull();
    expect(formatBeijingMinute("不是日期")).toBe("不是日期");
    expect(formatBeijingClock("不是日期")).toBe("");
  });

  it("datetime-local 值按北京时间解析成 UTC 串", () => {
    expect(beijingWallClockToIso("2026-09-01T08:00")).toBe(
      "2026-09-01T00:00:00.000Z",
    );
    expect(beijingWallClockToIso("2026-09-01T08:00:30")).toBe(
      "2026-09-01T00:00:30.000Z",
    );
    // 不存在的日历日与非法格式都不能被静默接受。
    expect(beijingWallClockToIso("2026-02-30T08:00")).toBeNull();
    expect(beijingWallClockToIso("2026-09-01")).toBeNull();
    expect(beijingWallClockToIso("")).toBeNull();
  });
});
