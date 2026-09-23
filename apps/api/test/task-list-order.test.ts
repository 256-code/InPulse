import { describe, expect, it } from "vitest";

import {
  TASK_LIST_SORT_KEY_VERSION,
  encodeTaskListSortKey,
  parseTaskListSortKey,
  type TaskListSortKey,
} from "../src/modules/tasks/task-list-order.js";

/**
 * 遗留问题来源从紧急桶最高档移到优先级之后的独立一级（2026-09-23 产品口径
 * 「遗留问题只需要比同优先级的高就行了」），紧急桶序号由 0..4 收窄为 0..3、
 * 载荷由 7 段变 8 段，游标版本随之由 4 升到 5：旧游标里的紧急桶序号在新口径下
 * 含义不同，继续接受会跳页 / 漏项，因此必须整版拒绝，而不是让它在 keyset 比较里
 * 静默退化。
 *
 * （更早一次：ADR-041 删除「低」（LOW）档位，优先级序号由 0/1/2/3 收窄为 0/1/2，
 * 游标版本由 3 升到 4。）
 */
describe("task-list-order 的游标版本", () => {
  const sample: TaskListSortKey = {
    statusGroup: 0,
    completedAt: null,
    urgency: 3,
    priority: 2,
    leftover: 1,
    dueAt: null,
    taskId: 501,
  };

  it("排序口径变化后版本升到 5", () => {
    expect(TASK_LIST_SORT_KEY_VERSION).toBe(5);
  });

  it("当前版本的排序键往返一致", () => {
    const encoded = encodeTaskListSortKey(sample);
    expect(encoded).toBe("5|0||3|2|1||501");
    expect(parseTaskListSortKey(encoded)).toEqual(sample);
  });

  it("旧版本（4 及更早）的游标整版拒绝", () => {
    // 版本 4 的键是 7 段，且第 4 段的紧急桶取值域与新版不同。
    expect(parseTaskListSortKey("4|0||4|2||501")).toBeNull();
    expect(
      parseTaskListSortKey("4|0||1|2|2026-09-18T01:00:00.000Z|42"),
    ).toBeNull();
    expect(parseTaskListSortKey("3|0||4|3||501")).toBeNull();
    expect(parseTaskListSortKey("2|0||4|2||501")).toBeNull();
  });

  it("新增的遗留问题字段同样要求数字，非法时拒绝", () => {
    expect(parseTaskListSortKey("5|0||3|2|x||501")).toBeNull();
  });
});
