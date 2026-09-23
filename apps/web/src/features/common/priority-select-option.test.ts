import { describe, expect, it } from "vitest";

import { priorityDotColor } from "./priority-select-option";

/**
 * 优先级圆点与任务卡片实色必须同源（D2 稿，2026-09-21 定案；2026-09-22 红档取中复核；
 * 2026-09-23「低」档位下线；同日二次定案「高改蓝、普通改白」与三次定案「高改金黄 #fdc106」）：
 * 两者是同一优先级的不同出现位置，取值漂移会让「紧急」在卡片和下拉里不同色。
 * 卡片实色定义在 design-system.css 末尾「任务卡片醒目配色」；
 * 「高」是金黄底卡，圆点取同族深版 #8a6e00；「普通」是白底卡，圆点取中性灰 #a0adb9
 * （配对口径：实色卡取实色、浅底卡取同族深版、白底卡取中性灰）。
 */
describe("priorityDotColor", () => {
  it("三个优先级按卡片取色：紧急红 / 高金 / 普通中性灰", () => {
    expect(priorityDotColor("URGENT")).toBe("#ce342b");
    expect(priorityDotColor("HIGH")).toBe("#8a6e00");
    expect(priorityDotColor("NORMAL")).toBe("#a0adb9");
  });

  it("已下线的「低」与其它未知值都按「普通」的中性灰处理，不整页崩溃", () => {
    expect(priorityDotColor("LOW")).toBe("#a0adb9");
    expect(priorityDotColor("SOMEDAY")).toBe("#a0adb9");
    expect(priorityDotColor("")).toBe("#a0adb9");
  });
});
