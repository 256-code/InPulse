import { describe, expect, it } from "vitest";

import { taskToneClassName, taskToneOf } from "./task-tone";

describe("taskToneOf", () => {
  it("按优先级取色：紧急红 / 高橙 / 普通蓝 / 低灰", () => {
    expect(taskToneOf("URGENT", "TODO")).toBe("urgent");
    expect(taskToneOf("HIGH", "TODO")).toBe("high");
    expect(taskToneOf("NORMAL", "TODO")).toBe("normal");
    expect(taskToneOf("LOW", "TODO")).toBe("low");
  });

  it("完成态覆盖优先级：已完成转绿、已取消转灰", () => {
    expect(taskToneOf("URGENT", "DONE")).toBe("done");
    expect(taskToneOf("HIGH", "CANCELED")).toBe("canceled");
  });

  it("截止紧迫度覆盖优先级：已逾期深红、马上到期橙红", () => {
    expect(taskToneOf("LOW", "TODO", "overdue")).toBe("overdue");
    expect(taskToneOf("URGENT", "TODO", "overdue")).toBe("overdue");
    expect(taskToneOf("HIGH", "TODO", "soon")).toBe("soon");
    expect(taskToneOf("NORMAL", "TODO", null)).toBe("normal");
  });

  it("完成态最优先：已完成 / 已取消不参与红档", () => {
    expect(taskToneOf("URGENT", "DONE", "overdue")).toBe("done");
    expect(taskToneOf("URGENT", "CANCELED", "soon")).toBe("canceled");
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
    expect(taskToneClassName("NORMAL", "TODO", "overdue")).toBe(
      "tone-prio-overdue",
    );
    expect(taskToneClassName("HIGH", "TODO", "soon")).toBe("tone-prio-soon");
  });
});
