import { describe, expect, it } from "vitest";

import {
  TASK_LIST_SORT_KEY_VERSION,
  encodeTaskListSortKey,
  parseTaskListSortKey,
  type TaskListSortKey,
} from "../src/modules/tasks/task-list-order.js";

/**
 * 游标版本随排序口径变化整版升级：
 * - ADR-041（2026-09-23）：删除「低」（LOW）档位，优先级序号由 0/1/2/3 收窄为 0/1/2，
 *   版本由 3 升到 4；旧游标里的 3（原「低」）不再有合法含义。
 * - 2026-09-23 并行开发线：遗留问题来源移到优先级之后的独立一级，载荷由 7 段变 8 段，
 *   版本由 4 升到 5；旧游标里的紧急桶序号在新口径下含义不同。
 * - 2026-09-24 产品口径「把遗留问题排到已经逾期后面」：两条并行开发线合并后统一采用本线
 *   口径——紧急桶重排为 标记紧急(0) → 已逾期(1) → 遗留问题来源(2) → 今/明日截止(3) →
 *   其余(4)，载荷回到 7 段，版本由 5 升到 6。
 * 以上每种变化都必须整版拒绝，而不是让它在 keyset 比较里静默退化。
 */
describe("task-list-order 的游标版本", () => {
  const sample: TaskListSortKey = {
    statusGroup: 0,
    completedAt: null,
    urgency: 4,
    priority: 2,
    dueAt: null,
    taskId: 501,
  };

  it("排序口径变化后版本升到 6", () => {
    expect(TASK_LIST_SORT_KEY_VERSION).toBe(6);
  });

  it("当前版本的排序键往返一致", () => {
    const encoded = encodeTaskListSortKey(sample);
    expect(encoded).toBe("6|0||4|2||501");
    expect(parseTaskListSortKey(encoded)).toEqual(sample);
  });

  it("上一版（5、4、3）及更早的游标整版拒绝", () => {
    // 版本 5（并行开发线）的载荷是 8 段、遗留问题来源为独立一级，段数与语义都与新版不同。
    expect(parseTaskListSortKey("5|0||1|2|1||501")).toBeNull();
    // 版本 4 的键里第 4 段 0 表示「遗留问题来源」原桶位，新口径下 0 是「标记紧急」，
    // 直接接受会把遗留问题任务当成紧急任务排到最前。
    expect(parseTaskListSortKey("4|0||0|2||501")).toBeNull();
    expect(parseTaskListSortKey("4|0||4|2||501")).toBeNull();
    // 版本 3 的键里第 5 段就是原来的「低」序号 3，不再有合法含义。
    expect(parseTaskListSortKey("3|0||4|3||501")).toBeNull();
    expect(parseTaskListSortKey("3|0||4|2||501")).toBeNull();
    expect(parseTaskListSortKey("2|0||4|2||501")).toBeNull();
  });

  it("字段非法或段数不符时拒绝", () => {
    // 第 6 段（任务 ID）必须是数字。
    expect(parseTaskListSortKey("6|0||4|2||x")).toBeNull();
    // 并行开发线 v5 的 8 段载荷在新口径下段数不符，整条拒绝。
    expect(parseTaskListSortKey("6|0||4|2|1||501")).toBeNull();
  });
});
