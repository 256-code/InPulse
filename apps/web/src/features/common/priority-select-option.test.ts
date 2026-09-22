import { describe, expect, it } from "vitest";

import { priorityDotColor } from "./priority-select-option";

/**
 * 优先级圆点与任务卡片实色必须同值（D2 稿，2026-09-21 定案）：
 * 两者是同一优先级的不同出现位置，取值漂移会让「紧急」在卡片和下拉里不同色。
 * 卡片实色定义在 design-system.css 末尾「任务卡片醒目配色」。
 */
describe("priorityDotColor", () => {
  it("四个优先级取卡片实色：紧急 / 高 / 普通 / 低", () => {
    expect(priorityDotColor("URGENT")).toBe("#d63b31");
    expect(priorityDotColor("HIGH")).toBe("#8a6e00");
    expect(priorityDotColor("NORMAL")).toBe("#0f6ae8");
    expect(priorityDotColor("LOW")).toBe("#a0adb9");
  });

  it("未知优先级按低的中性灰处理，不整页崩溃", () => {
    expect(priorityDotColor("SOMEDAY")).toBe("#a0adb9");
    expect(priorityDotColor("")).toBe("#a0adb9");
  });
});
