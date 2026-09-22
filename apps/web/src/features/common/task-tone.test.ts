/**
 * task-tone.ts 的覆盖次序用例（2026-09-22 三次定案：逾期不再整卡换色）。
 * 口径：完成态 > 优先级身份（紧急最高）> 遗留问题来源 > 其余优先级。
 * 截止紧迫度（已逾期 / 今天到期）不再参与配色，只在排序与日期文案上体现。
 */
import { describe, expect, it } from "vitest";

import { taskToneClassName, taskToneOf } from "./task-tone";

describe("taskToneOf", () => {
  it("按优先级取色：紧急红 / 高明黄 / 普通蓝 / 低灰", () => {
    expect(taskToneOf("URGENT", "TODO")).toBe("urgent");
    expect(taskToneOf("HIGH", "TODO")).toBe("high");
    expect(taskToneOf("NORMAL", "TODO")).toBe("normal");
    expect(taskToneOf("LOW", "TODO")).toBe("low");
  });

  it("完成态覆盖优先级：已完成转青碧、已取消转灰", () => {
    expect(taskToneOf("URGENT", "DONE")).toBe("done");
    expect(taskToneOf("HIGH", "CANCELED")).toBe("canceled");
  });

  it("遗留问题来源覆盖优先级转锈红，但完成态与紧急仍优先", () => {
    expect(taskToneOf("NORMAL", "TODO", true)).toBe("leftover");
    expect(taskToneOf("HIGH", "TODO", true)).toBe("leftover");
    expect(taskToneOf("LOW", "TODO", true)).toBe("leftover");
    // 紧急是优先级身份里最高的一档，不被来源标记盖掉。
    expect(taskToneOf("URGENT", "TODO", true)).toBe("urgent");
    expect(taskToneOf("NORMAL", "DONE", true)).toBe("done");
    expect(taskToneOf("NORMAL", "CANCELED", true)).toBe("canceled");
    // 不是遗留项时口径不变。
    expect(taskToneOf("NORMAL", "TODO", false)).toBe("normal");
  });

  it("未知优先级按低处理，不整页崩溃", () => {
    expect(taskToneOf("SOMEDAY", "TODO")).toBe("low");
    expect(taskToneOf("", "")).toBe("low");
  });
});

describe("taskToneClassName", () => {
  it("输出 design-system.css 的 tone 类名", () => {
    expect(taskToneClassName("URGENT", "TODO")).toBe("tone-prio-urgent");
    expect(taskToneClassName("LOW", "DONE")).toBe("tone-prio-done");
    expect(taskToneClassName("NORMAL", "CANCELED")).toBe("tone-prio-canceled");
    expect(taskToneClassName("NORMAL", "TODO", true)).toBe(
      "tone-prio-leftover",
    );
  });

  it("不再产出「已逾期 / 马上到期」的整卡 tone 类名", () => {
    // 逾期任务按自己的优先级取色（产品 2026-09-22：「逾期的不搞特殊了」）。
    expect(taskToneClassName("HIGH", "TODO")).toBe("tone-prio-high");
    expect(taskToneClassName("LOW", "TODO")).toBe("tone-prio-low");
    expect(taskToneClassName("NORMAL", "TODO")).toBe("tone-prio-normal");
    for (const className of [
      taskToneClassName("URGENT", "TODO"),
      taskToneClassName("HIGH", "TODO"),
      taskToneClassName("NORMAL", "TODO"),
      taskToneClassName("LOW", "TODO"),
    ]) {
      expect(className).not.toBe("tone-prio-overdue");
      expect(className).not.toBe("tone-prio-soon");
    }
  });
});
