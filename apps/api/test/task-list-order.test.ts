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
 * - 2026-09-23：遗留问题来源移到优先级之后的独立一级，载荷由 7 段变 8 段，版本由 4 升到 5；
 *   旧游标里的紧急桶序号在新口径下含义不同。
 * - 2026-09-24：两条并行开发线合并时曾把遗留问题来源并回紧急桶（标记紧急 → 已逾期 →
 *   遗留问题来源 → 今/明日截止 → 其余），载荷回到 7 段，版本由 5 升到 6。
 * - 2026-09-24 产品定案（原文「遗留问题只会在同优先级里面高一点……以后不管是别人拉取
 *   还是，都要以这个为准」）撤销上一条：遗留问题来源退出紧急桶、回到优先级之后的独立一级，
 *   紧急桶收窄为 0..3，载荷回到 8 段，版本由 6 升到 7。
 * 以上每种变化都必须整版拒绝，而不是让它在 keyset 比较里静默退化。
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

  it("排序口径变化后版本升到 7", () => {
    expect(TASK_LIST_SORT_KEY_VERSION).toBe(7);
  });

  it("当前版本的排序键往返一致", () => {
    const encoded = encodeTaskListSortKey(sample);
    expect(encoded).toBe("7|0||3|2|1||501");
    expect(parseTaskListSortKey(encoded)).toEqual(sample);
  });

  it("上一版（6、5、4、3）及更早的游标整版拒绝", () => {
    // 版本 6 的载荷是 7 段、第 4 段 0..4 的紧急桶里含着「遗留问题来源(2)」，
    // 直接接受会把遗留问题任务当成已逾期或按旧桶位排出错误顺序。
    expect(parseTaskListSortKey("6|0||4|2||501")).toBeNull();
    expect(parseTaskListSortKey("6|0||2|2||501")).toBeNull();
    // 版本 5 的载荷是 8 段、遗留问题来源为独立一级，但版本号不符同样拒绝。
    expect(parseTaskListSortKey("5|0||3|2|1||501")).toBeNull();
    // 版本 4 的键里第 4 段 0 是当时的「遗留问题来源」桶位，新口径下 0 是「标记紧急」。
    expect(parseTaskListSortKey("4|0||0|2||501")).toBeNull();
    expect(parseTaskListSortKey("4|0||4|2||501")).toBeNull();
    // 版本 3 的键里第 5 段就是原来的「低」序号 3，不再有合法含义。
    expect(parseTaskListSortKey("3|0||4|3||501")).toBeNull();
    expect(parseTaskListSortKey("3|0||4|2||501")).toBeNull();
    expect(parseTaskListSortKey("2|0||4|2||501")).toBeNull();
  });

  it("字段非法或段数不符时拒绝", () => {
    // 第 8 段（任务 ID）必须是数字。
    expect(parseTaskListSortKey("7|0||3|2|1||x")).toBeNull();
    // 第 6 段（遗留问题来源）必须是数字。
    expect(parseTaskListSortKey("7|0||3|2|x||501")).toBeNull();
    // v6 的 7 段载荷在新口径下段数不符，整条拒绝。
    expect(parseTaskListSortKey("7|0||3|2||501")).toBeNull();
  });
});
