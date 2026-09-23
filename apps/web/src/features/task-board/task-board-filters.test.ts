import { describe, expect, it } from "vitest";

import type { TaskBoardCard, TaskBoardModule } from "./task-board-types";
import {
  collectTaskBoardAssignees,
  countTaskBoardTasks,
  DEFAULT_TASK_BOARD_FILTERS,
  filterTaskBoardModules,
  hasActiveTaskBoardFilters,
  matchesTaskBoardCard,
  readTaskBoardFilters,
  writeTaskBoardFilters,
} from "./task-board-filters";

function cardOf(overrides: Partial<TaskBoardCard> = {}): TaskBoardCard {
  return {
    taskId: 1,
    code: "T-1001",
    title: "实现任务看板",
    moduleId: 3,
    featureId: 5,
    featureName: "任务看板",
    scopeType: "FEATURE",
    priority: "NORMAL",
    workStatus: "TODO",
    dueAt: "2026-09-20T02:00:00.000Z",
    completedAt: null,
    dueState: "SCHEDULED",
    assignee: { userId: 9, name: "张启明", avatarUrl: null },
    publishedRecordCount: 0,
    ...overrides,
  };
}

function laneOf(
  moduleId: number,
  tasks: readonly TaskBoardCard[],
): TaskBoardModule {
  return {
    moduleId,
    name: "模块 " + moduleId,
    featureCount: 1,
    stats: {
      total: tasks.length,
      done: 0,
      open: tasks.length,
      canceled: 0,
      overdue: 0,
      completionRate: 0,
    },
    assignees: [],
    tasks,
  };
}

describe("readTaskBoardFilters", () => {
  it("缺失与非法参数一律回退默认值", () => {
    expect(readTaskBoardFilters(new URLSearchParams())).toEqual(
      DEFAULT_TASK_BOARD_FILTERS,
    );
    const raw = new URLSearchParams({
      view: "table",
      status: "closed",
      time: "week",
      priority: "P0",
      owner: "0",
      q: "看板",
    });
    expect(readTaskBoardFilters(raw)).toEqual({
      ...DEFAULT_TASK_BOARD_FILTERS,
      query: "看板",
    });
  });

  it("解析列表视图、逾期、优先级与负责人", () => {
    const raw = new URLSearchParams({
      view: "list",
      status: "open",
      time: "overdue",
      priority: "HIGH",
      owner: "42",
    });
    expect(readTaskBoardFilters(raw)).toEqual({
      view: "list",
      status: "open",
      time: "overdue",
      priority: "HIGH",
      assigneeId: 42,
      query: "",
    });
  });
});

describe("writeTaskBoardFilters", () => {
  it("默认值不写入 URL，查询词去除首尾空白", () => {
    expect(writeTaskBoardFilters(DEFAULT_TASK_BOARD_FILTERS).toString()).toBe(
      "",
    );
    const params = writeTaskBoardFilters({
      view: "list",
      status: "done",
      time: "today",
      priority: "URGENT",
      assigneeId: 7,
      query: "  看板  ",
    });
    expect(params.get("view")).toBe("list");
    expect(params.get("status")).toBe("done");
    expect(params.get("time")).toBe("today");
    expect(params.get("priority")).toBe("URGENT");
    expect(params.get("owner")).toBe("7");
    expect(params.get("q")).toBe("看板");
  });

  it("读写往返一致", () => {
    const filters = {
      view: "list",
      status: "canceled",
      time: "all",
      priority: "NORMAL",
      assigneeId: 3,
      query: "回归",
    } as const;
    expect(readTaskBoardFilters(writeTaskBoardFilters(filters))).toEqual(
      filters,
    );
  });
});

describe("hasActiveTaskBoardFilters", () => {
  it("视图切换不算筛选，空白查询词不算筛选", () => {
    expect(
      hasActiveTaskBoardFilters({
        ...DEFAULT_TASK_BOARD_FILTERS,
        view: "list",
      }),
    ).toBe(false);
    expect(
      hasActiveTaskBoardFilters({
        ...DEFAULT_TASK_BOARD_FILTERS,
        query: "   ",
      }),
    ).toBe(false);
    expect(
      hasActiveTaskBoardFilters({
        ...DEFAULT_TASK_BOARD_FILTERS,
        status: "open",
      }),
    ).toBe(true);
    expect(
      hasActiveTaskBoardFilters({
        ...DEFAULT_TASK_BOARD_FILTERS,
        time: "today",
      }),
    ).toBe(true);
  });
});

describe("matchesTaskBoardCard", () => {
  it("状态筛选只认服务端 workStatus", () => {
    const done = cardOf({ taskId: 2, workStatus: "DONE", dueState: "NONE" });
    expect(
      matchesTaskBoardCard(done, {
        ...DEFAULT_TASK_BOARD_FILTERS,
        status: "open",
      }),
    ).toBe(false);
    expect(
      matchesTaskBoardCard(done, {
        ...DEFAULT_TASK_BOARD_FILTERS,
        status: "done",
      }),
    ).toBe(true);
    expect(
      matchesTaskBoardCard(done, {
        ...DEFAULT_TASK_BOARD_FILTERS,
        status: "canceled",
      }),
    ).toBe(false);
  });

  it("逾期与今日到期只读 dueState，不在前端按本地时钟重算", () => {
    const overdue = cardOf({ dueState: "OVERDUE" });
    expect(
      matchesTaskBoardCard(overdue, {
        ...DEFAULT_TASK_BOARD_FILTERS,
        time: "overdue",
      }),
    ).toBe(true);
    expect(
      matchesTaskBoardCard(overdue, {
        ...DEFAULT_TASK_BOARD_FILTERS,
        time: "today",
      }),
    ).toBe(false);
  });

  it("优先级与负责人不匹配即排除", () => {
    const card = cardOf();
    expect(
      matchesTaskBoardCard(card, {
        ...DEFAULT_TASK_BOARD_FILTERS,
        priority: "HIGH",
      }),
    ).toBe(false);
    expect(
      matchesTaskBoardCard(card, {
        ...DEFAULT_TASK_BOARD_FILTERS,
        assigneeId: 9,
      }),
    ).toBe(true);
    expect(
      matchesTaskBoardCard(card, {
        ...DEFAULT_TASK_BOARD_FILTERS,
        assigneeId: 10,
      }),
    ).toBe(false);
  });

  it("关键词覆盖编号、标题、功能名与负责人，且忽略大小写", () => {
    const card = cardOf({
      code: "AGV-12",
      title: "Fix Board",
      featureName: "调度",
      assignee: { userId: 9, name: "Ada", avatarUrl: null },
    });
    for (const term of ["agv-12", "fix board", "调度", "ada"]) {
      expect(
        matchesTaskBoardCard(card, {
          ...DEFAULT_TASK_BOARD_FILTERS,
          query: term,
        }),
      ).toBe(true);
    }
    expect(
      matchesTaskBoardCard(card, {
        ...DEFAULT_TASK_BOARD_FILTERS,
        query: "不存在",
      }),
    ).toBe(false);
  });
});

describe("filterTaskBoardModules", () => {
  it("按筛选裁剪任务、隐藏空泳道，且不改动入参", () => {
    const board: readonly TaskBoardModule[] = [
      laneOf(3, [
        cardOf(),
        cardOf({ taskId: 2, workStatus: "DONE", dueState: "NONE" }),
      ]),
      laneOf(4, [
        cardOf({
          taskId: 3,
          moduleId: 4,
          workStatus: "CANCELED",
          dueState: "NONE",
        }),
      ]),
    ];

    const filtered = filterTaskBoardModules(board, {
      ...DEFAULT_TASK_BOARD_FILTERS,
      status: "done",
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.moduleId).toBe(3);
    expect(filtered[0]?.tasks).toHaveLength(1);
    expect(countTaskBoardTasks(filtered)).toBe(1);
    expect(board[0]?.tasks).toHaveLength(2);
  });
});

describe("collectTaskBoardAssignees", () => {
  it("按姓名排序去重，且不受筛选影响", () => {
    const board: readonly TaskBoardModule[] = [
      laneOf(3, [
        cardOf({ assignee: { userId: 9, name: "张启明", avatarUrl: null } }),
        cardOf({
          taskId: 2,
          assignee: { userId: 9, name: "张启明", avatarUrl: null },
        }),
      ]),
      laneOf(4, [
        cardOf({
          taskId: 3,
          assignee: { userId: 4, name: "Ada", avatarUrl: null },
        }),
      ]),
    ];

    const nameOf = (userId: number): string =>
      userId === 4 ? "Ada" : "张启明";
    const collected = collectTaskBoardAssignees(board);
    expect(collected).toHaveLength(2);
    expect(collected.map((user) => user.userId)).toEqual(
      [4, 9].sort((left, right) =>
        nameOf(left).localeCompare(nameOf(right), "zh-Hans-CN"),
      ),
    );
  });
});
