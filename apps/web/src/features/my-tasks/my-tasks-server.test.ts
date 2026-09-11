import { describe, expect, it, vi } from "vitest";
import type { InpulseApiClient, MyTaskPage } from "@generated/api";
import { DEFAULT_MY_TASK_FILTERS } from "./my-tasks-url";
import {
  createMyTasksServerAdapter,
  MY_TASKS_SERVER_NOTICE,
} from "./my-tasks-server";
import { MY_TASKS_V1_FILTER_SUPPORT } from "./my-tasks-v1-query";

const page: MyTaskPage = {
  items: [
    {
      taskId: 41,
      code: "T-1041",
      title: "补齐聚合读游标过期用例",
      projectId: 7,
      projectName: "InPulse 平台",
      moduleId: 3,
      moduleName: "聚合读",
      featureId: 9,
      featureName: "任务中心",
      scopeType: "FEATURE",
      workStatus: "TODO",
      lifecycleStatus: "ACTIVE",
      assignee: { userId: 2, name: "开发者 C", avatarUrl: null },
      updatedAt: "2026-09-10T09:00:00.000Z",
      hasPublishedRecord: true,
      groupRole: "MAIN",
      priority: "NORMAL",
      dueAt: null,
      completedAt: null,
      creatorId: 2,
      githubLinkCount: 0,
      groupId: null,
    },
  ],
  nextCursor: "signed-cursor",
  hasMore: true,
  stats: { myOpen: 1, dueToday: 0, overdue: 0, completedThisMonth: 0 },
  leftoverCount: 0,
  leftoverSample: null,
};

describe("my tasks server adapter", () => {
  it("calls the generated client with the frozen R-3 query", async () => {
    const listMyTasks = vi.fn().mockResolvedValue(page);
    const client = { listMyTasks } as unknown as InpulseApiClient;
    const adapter = createMyTasksServerAdapter(client);

    expect(adapter.source).toBe("server");
    expect(adapter.notice).toBe(MY_TASKS_SERVER_NOTICE);

    const result = await adapter.fetchMyTasks({
      filters: DEFAULT_MY_TASK_FILTERS,
      viewerId: 2,
    });

    expect(listMyTasks).toHaveBeenCalledWith({
      limit: 20,
      workStatus: "TODO",
    });
    expect(result.items).toEqual([
      {
        taskId: 41,
        code: "T-1041",
        title: "补齐聚合读游标过期用例",
        projectId: 7,
        projectName: "InPulse 平台",
        moduleId: 3,
        moduleName: "聚合读",
        featureId: 9,
        featureName: "任务中心",
        scopeType: "FEATURE",
        workStatus: "TODO",
        lifecycleStatus: "ACTIVE",
        updatedAt: "2026-09-10T09:00:00.000Z",
        assignee: { userId: 2, name: "开发者 C", avatarUrl: null },
        hasPublishedRecord: true,
        groupRole: "MAIN",
      },
    ]);
    expect(result.nextCursor).toBe("signed-cursor");
    expect(result.hasMore).toBe(true);
  });

  it("keeps the frozen contract gaps as explicit nulls", async () => {
    const listMyTasks = vi.fn().mockResolvedValue(page);
    const client = { listMyTasks } as unknown as InpulseApiClient;
    const adapter = createMyTasksServerAdapter(client);

    const result = await adapter.fetchMyTasks({
      filters: DEFAULT_MY_TASK_FILTERS,
      viewerId: 2,
    });

    expect(result.stats).toBeNull();
    expect(result.scopeCounts).toBeNull();
    expect(result.leftoverCount).toBeNull();
    expect(result.leftoverSample).toBeNull();
    expect(result.filterSupport).toBe(MY_TASKS_V1_FILTER_SUPPORT);
    expect(
      Object.values(result.filterSupport).every((supported) => !supported),
    ).toBe(true);
  });

  it("keeps the notice explicit about the frozen contract gaps", () => {
    expect(MY_TASKS_SERVER_NOTICE).toContain("统计卡片");
    expect(MY_TASKS_SERVER_NOTICE).toContain("优先级");
  });
});
