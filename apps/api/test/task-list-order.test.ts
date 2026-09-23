import { describe, expect, it } from "vitest";

import {
  TASK_LIST_SORT_KEY_VERSION,
  encodeTaskListSortKey,
  parseTaskListSortKey,
  type TaskListSortKey,
} from "../src/modules/tasks/task-list-order.js";

/**
 * ADR-041：删除「低」（LOW）优先级档位。
 *
 * 排序键里的优先级序号由 0/1/2/3 收窄为 0/1/2，游标版本随之由 3 升到 4：
 * 旧游标里的 3（原「低」）在新口径下不再是任何任务的序号，继续接受会跳页 / 漏项，
 * 因此必须整版拒绝，而不是让它在 keyset 比较里静默退化。
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

  it("排序口径变化后版本升到 4", () => {
    expect(TASK_LIST_SORT_KEY_VERSION).toBe(4);
  });

  it("当前版本的排序键往返一致", () => {
    const encoded = encodeTaskListSortKey(sample);
    expect(encoded).toBe("4|0||4|2||501");
    expect(parseTaskListSortKey(encoded)).toEqual(sample);
  });

  it("上一版（3）及更早的游标整版拒绝", () => {
    // 版本 3 的键里第 5 段就是原来的「低」序号 3，不再有合法含义。
    expect(parseTaskListSortKey("3|0||4|3||501")).toBeNull();
    expect(parseTaskListSortKey("3|0||4|2||501")).toBeNull();
    expect(parseTaskListSortKey("2|0||4|2||501")).toBeNull();
  });
});
