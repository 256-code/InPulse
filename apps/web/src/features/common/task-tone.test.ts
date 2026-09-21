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
  });
});
