/**
 * task-tone.ts 的覆盖次序用例（2026-09-22 三次定案：逾期不再整卡换色；
 * 2026-09-23 四次定案：删除「低」档位，优先级只剩 紧急 / 高 / 普通；
 * 同日五次定案：「高」改蓝、「普通」改白 / 中性灰；六次定案：产品给出品牌金，
 * 「高」的卡片改金黄 #fdc106、徽章色调回到 amber，「普通」保持白卡 + 中性灰；
 * 八次配色定案：遗留问题来源退出配色，卡片只按工作状态与优先级取色）。
 * 口径：完成态（已完成 / 已取消）> 优先级身份（紧急最高）> 其余按优先级，未知值落「普通」。
 * 截止紧迫度（已逾期 / 今天到期）不参与配色，只在排序与日期文案上体现。
 */
import { describe, expect, it } from "vitest";

import {
  taskPriorityBadgeTone,
  taskToneClassName,
  taskToneOf,
} from "./task-tone";

describe("taskToneOf", () => {
  it("按优先级取色：紧急红 / 高金 / 普通白", () => {
    expect(taskToneOf("URGENT", "TODO")).toBe("urgent");
    expect(taskToneOf("HIGH", "TODO")).toBe("high");
    expect(taskToneOf("NORMAL", "TODO")).toBe("normal");
  });

  it("完成态覆盖优先级：已完成转青碧、已取消转灰", () => {
    expect(taskToneOf("URGENT", "DONE")).toBe("done");
    expect(taskToneOf("HIGH", "CANCELED")).toBe("canceled");
  });

  it("遗留问题来源不参与配色：转换而来的任务按自己的优先级取色", () => {
    // 2026-09-23 八次配色定案（产品要求「遗留问题也按照优先级呈现颜色」）：taskToneOf
    // 只看工作状态与优先级，来源由「遗留问题」徽章单独表达（见 TaskCenterPageView.test.tsx
    // 与 TasksPanel.test.tsx 的 badge-leftover 断言）。
    expect(taskToneOf("NORMAL", "TODO")).toBe("normal");
    expect(taskToneOf("HIGH", "TODO")).toBe("high");
    expect(taskToneOf("URGENT", "TODO")).toBe("urgent");
    expect(taskToneOf("NORMAL", "DONE")).toBe("done");
    expect(taskToneOf("NORMAL", "CANCELED")).toBe("canceled");
  });

  it("已下线的「低」与其它未知值都落到「普通」，不整页崩溃", () => {
    expect(taskToneOf("LOW", "TODO")).toBe("normal");
    expect(taskToneOf("SOMEDAY", "TODO")).toBe("normal");
    expect(taskToneOf("", "")).toBe("normal");
  });
});

describe("taskPriorityBadgeTone", () => {
  it("徽章色调：紧急红 / 高金 / 普通淡蓝（与「进行中」同一套蓝）", () => {
    // 2026-09-23 九次配色定案：产品要求「普通」参照「进行中」的淡蓝 #e6f2ff / #2472c3。
    expect(taskPriorityBadgeTone("URGENT")).toBe("red");
    expect(taskPriorityBadgeTone("HIGH")).toBe("amber");
    expect(taskPriorityBadgeTone("NORMAL")).toBe("blue");
  });

  it("已下线的「低」与其它未知值都按中性灰处理，不整页崩溃", () => {
    expect(taskPriorityBadgeTone("LOW")).toBe("gray");
    expect(taskPriorityBadgeTone("SOMEDAY")).toBe("gray");
    expect(taskPriorityBadgeTone("")).toBe("gray");
  });
});

describe("taskToneClassName", () => {
  it("输出 design-system.css 的 tone 类名", () => {
    expect(taskToneClassName("URGENT", "TODO")).toBe("tone-prio-urgent");
    expect(taskToneClassName("NORMAL", "DONE")).toBe("tone-prio-done");
    expect(taskToneClassName("NORMAL", "CANCELED")).toBe("tone-prio-canceled");
  });

  it("不再产出「已逾期 / 马上到期」的整卡 tone 类名", () => {
    // 逾期任务按自己的优先级取色（产品 2026-09-22：「逾期的不搞特殊了」）。
    expect(taskToneClassName("HIGH", "TODO")).toBe("tone-prio-high");
    expect(taskToneClassName("NORMAL", "TODO")).toBe("tone-prio-normal");
    for (const className of [
      taskToneClassName("URGENT", "TODO"),
      taskToneClassName("HIGH", "TODO"),
      taskToneClassName("NORMAL", "TODO"),
      taskToneClassName("LOW", "TODO"),
    ]) {
      expect(className).not.toBe("tone-prio-overdue");
      expect(className).not.toBe("tone-prio-soon");
      // 「低」档位的类名已从 design-system.css 删除，不得再被产出。
      expect(className).not.toBe("tone-prio-low");
      // 2026-09-23 八次配色定案删除了「遗留问题」来源档，同样不得再被产出。
      expect(className).not.toBe("tone-prio-leftover");
    }
  });
});
