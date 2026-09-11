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
      publishedRecordCount: 1,
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
  leftoverCount: 1,
  leftoverSample: { recordCode: "R-021", summary: "恢复码入口待补齐" },
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
        priority: "NORMAL",
        dueAt: null,
        completedAt: null,
        creatorId: 2,
        githubLinkCount: 0,
        hasPublishedRecord: true,
        groupRole: "MAIN",
        groupId: null,
      },
    ]);
    expect(result.nextCursor).toBe("signed-cursor");
    expect(result.hasMore).toBe(true);
  });

  it("passes priority and the canceled union to the generated client", async () => {
    const listMyTasks = vi.fn().mockResolvedValue(page);
    const client = { listMyTasks } as unknown as InpulseApiClient;
    const adapter = createMyTasksServerAdapter(client);

    await adapter.fetchMyTasks({
      filters: {
        ...DEFAULT_MY_TASK_FILTERS,
        status: "open",
        includeCanceled: true,
        priority: "HIGH",
      },
      viewerId: 2,
    });

    expect(listMyTasks).toHaveBeenCalledWith({
      limit: 20,
      workStatus: "TODO",
      priority: "HIGH",
      includeCanceled: true,
    });
  });

  it("wires stats and leftovers from the page while scopeCounts stays deferred", async () => {
    const listMyTasks = vi.fn().mockResolvedValue(page);
    const client = { listMyTasks } as unknown as InpulseApiClient;
    const adapter = createMyTasksServerAdapter(client);

    const result = await adapter.fetchMyTasks({
      filters: DEFAULT_MY_TASK_FILTERS,
      viewerId: 2,
    });

    expect(result.stats).toEqual(page.stats);
    expect(result.scopeCounts).toBeNull();
    expect(result.leftoverCount).toBe(1);
    expect(result.leftoverSample).toEqual({
      recordCode: "R-021",
      summary: "恢复码入口待补齐",
    });
    expect(result.filterSupport).toBe(MY_TASKS_V1_FILTER_SUPPORT);
    expect(result.filterSupport["filter:priority"]).toBe(true);
    expect(result.filterSupport["filter:canceled-with-open"]).toBe(true);
    expect(result.filterSupport["filter:query"]).toBe(false);
  });

  it("maps the R-7 task group page through the generated client", async () => {
    const listTaskGroups = vi.fn().mockResolvedValue({
      items: [
        {
          groupId: 501,
          projectId: 1,
          projectName: "InPulse 平台",
          code: "TG-001",
          name: "任务合并后来源分支历史保留",
          status: "ACTIVE",
          mainTask: {
            taskId: 102,
            code: "T-102",
            projectId: 1,
            moduleId: 12,
            featureId: 121,
          },
          branches: [],
        },
      ],
      nextCursor: "group-cursor",
      hasMore: true,
    });
    const client = { listTaskGroups } as unknown as InpulseApiClient;
    const adapter = createMyTasksServerAdapter(client);

    const scoped = await adapter.fetchTaskGroups({
      projectId: 1,
      cursor: null,
    });
    expect(listTaskGroups).toHaveBeenCalledWith({ limit: 20, projectId: 1 });
    expect(scoped.items).toHaveLength(1);
    expect(scoped.items[0]?.code).toBe("TG-001");
    expect(scoped.nextCursor).toBe("group-cursor");
    expect(scoped.hasMore).toBe(true);

    await adapter.fetchTaskGroups({ projectId: null, cursor: "group-cursor" });
    expect(listTaskGroups).toHaveBeenLastCalledWith({
      limit: 20,
      cursor: "group-cursor",
    });
  });

  it("keeps the notice explicit about the wired data and the remaining gaps", () => {
    expect(MY_TASKS_SERVER_NOTICE).toContain("统计卡片");
    expect(MY_TASKS_SERVER_NOTICE).toContain("优先级");
    expect(MY_TASKS_SERVER_NOTICE).toContain("范围计数");
  });
});
