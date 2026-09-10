import { describe, expect, it } from "vitest";
import { DEFAULT_MY_TASK_FILTERS } from "./my-tasks-url";
import type { MyTaskFilters } from "./my-tasks-types";
import {
  clampMyTasksV1Limit,
  fromV1MyTaskItem,
  listMyTasksV1Gaps,
  MY_TASKS_V1_FILTER_SUPPORT,
  MY_TASKS_V1_LIMIT_DEFAULT,
  MY_TASKS_V1_LIMIT_MAX,
  MY_TASKS_V1_MISSING_ITEM_FIELDS,
  MY_TASKS_V1_MISSING_RESPONSE_PARTS,
  MY_TASKS_V1_PATH,
  toMyTasksV1Query,
  toMyTasksV1WorkStatus,
} from "./my-tasks-v1-query";

function filters(overrides: Partial<MyTaskFilters> = {}): MyTaskFilters {
  return { ...DEFAULT_MY_TASK_FILTERS, ...overrides };
}

describe("my-tasks-v1-query", () => {
  it("keeps the frozen R-3 path and defaults", () => {
    expect(MY_TASKS_V1_PATH).toBe("/api/v1/me/tasks");
    expect(toMyTasksV1Query(filters())).toEqual({
      limit: 20,
      workStatus: "TODO",
    });
    expect(MY_TASKS_V1_LIMIT_DEFAULT).toBe(20);
    expect(MY_TASKS_V1_LIMIT_MAX).toBe(100);
  });

  it("maps the project scope and level onto projectId and scopeType", () => {
    expect(
      toMyTasksV1Query(
        filters({
          scope: "project",
          projectId: 7,
          level: "MODULE",
          status: "all",
        }),
      ),
    ).toEqual({ limit: 20, projectId: 7, scopeType: "MODULE" });
    expect(
      toMyTasksV1Query(filters({ scope: "project", projectId: null }))
        .projectId,
    ).toBeUndefined();
  });

  it("maps workStatus for open and done only", () => {
    expect(toMyTasksV1WorkStatus(filters({ status: "open" }))).toBe("TODO");
    expect(toMyTasksV1WorkStatus(filters({ status: "done" }))).toBe("DONE");
    expect(toMyTasksV1WorkStatus(filters({ status: "all" }))).toBeNull();
    expect(toMyTasksV1Query(filters({ status: "all" }))).toEqual({ limit: 20 });
    expect(toMyTasksV1Query(filters({ status: "done" })).workStatus).toBe(
      "DONE",
    );
  });

  it("maps the record filter onto hasPublishedRecord", () => {
    expect(
      toMyTasksV1Query(filters({ hasRecord: "yes" })).hasPublishedRecord,
    ).toBe(true);
    expect(
      toMyTasksV1Query(filters({ hasRecord: "no" })).hasPublishedRecord,
    ).toBe(false);
    expect(toMyTasksV1Query(filters()).hasPublishedRecord).toBeUndefined();
  });

  it("omits empty cursors and clamps out-of-range limits", () => {
    const allStatus = filters({ status: "all" });
    expect(toMyTasksV1Query(allStatus, { cursor: "" })).toEqual({ limit: 20 });
    expect(toMyTasksV1Query(allStatus, { cursor: null })).toEqual({
      limit: 20,
    });
    expect(toMyTasksV1Query(allStatus, { cursor: "abc" }).cursor).toBe("abc");
    expect(toMyTasksV1Query(filters(), { limit: 500 }).limit).toBe(100);
    expect(toMyTasksV1Query(filters(), { limit: 0 }).limit).toBe(20);
    expect(toMyTasksV1Query(filters(), { limit: 2.5 }).limit).toBe(20);
    expect(clampMyTasksV1Limit(1)).toBe(1);
  });

  it("reports every UI filter V1 cannot express", () => {
    expect(
      listMyTasksV1Gaps(
        filters({
          scope: "all",
          priority: "HIGH",
          relation: "MAIN",
          hasGithub: "no",
          query: "登录",
        }),
      ),
    ).toEqual([
      "scope:all",
      "filter:priority",
      "filter:relation",
      "filter:github",
      "filter:query",
    ]);
  });

  it("reports the canceled union gap only for the open status", () => {
    expect(listMyTasksV1Gaps(filters({ includeCanceled: true }))).toEqual([
      "filter:canceled-with-open",
    ]);
    expect(
      listMyTasksV1Gaps(filters({ status: "all", includeCanceled: true })),
    ).toEqual([]);
  });

  it("returns no gaps for the four frozen V1 filters", () => {
    expect(
      listMyTasksV1Gaps(
        filters({
          scope: "project",
          projectId: 3,
          status: "done",
          level: "FEATURE",
          hasRecord: "yes",
        }),
      ),
    ).toEqual([]);
  });

  it("reports a project scope without a project id", () => {
    expect(
      listMyTasksV1Gaps(filters({ scope: "project", projectId: null })),
    ).toEqual(["scope:project-without-id"]);
  });

  it("maps the frozen R-3 item and keeps contract gaps undefined", () => {
    const item = fromV1MyTaskItem({
      taskId: 7,
      code: "T-007",
      title: "补齐恢复码入口",
      projectId: 1,
      projectName: "InPulse 平台",
      moduleId: 2,
      moduleName: "访问控制",
      featureId: 3,
      featureName: "MFA 登录",
      scopeType: "FEATURE",
      workStatus: "DONE",
      lifecycleStatus: "ACTIVE",
      assignee: { userId: 9, name: "张三", avatarUrl: null },
      updatedAt: "2026-09-10T02:00:00.000Z",
      hasPublishedRecord: true,
      groupRole: "SOURCE",
    });
    expect(item).toEqual({
      taskId: 7,
      code: "T-007",
      title: "补齐恢复码入口",
      projectId: 1,
      projectName: "InPulse 平台",
      moduleId: 2,
      moduleName: "访问控制",
      featureId: 3,
      featureName: "MFA 登录",
      scopeType: "FEATURE",
      workStatus: "DONE",
      lifecycleStatus: "ACTIVE",
      assignee: { userId: 9, name: "张三", avatarUrl: null },
      updatedAt: "2026-09-10T02:00:00.000Z",
      hasPublishedRecord: true,
      groupRole: "SOURCE",
    });
    expect(item.priority).toBeUndefined();
    expect(item.dueAt).toBeUndefined();
    expect(item.completedAt).toBeUndefined();
    expect(item.creatorId).toBeUndefined();
    expect(item.description).toBeUndefined();
    expect(item.githubLinkCount).toBeUndefined();
  });

  it("declares that the frozen contract supports none of the UI filter gaps", () => {
    expect(MY_TASKS_V1_FILTER_SUPPORT).toEqual({
      "scope:created": false,
      "scope:all": false,
      "scope:project-without-id": false,
      "filter:priority": false,
      "filter:relation": false,
      "filter:github": false,
      "filter:query": false,
      "filter:canceled-with-open": false,
    });
  });

  it("keeps the documented response gaps stable", () => {
    expect(MY_TASKS_V1_MISSING_ITEM_FIELDS).toContain("priority");
    expect(MY_TASKS_V1_MISSING_ITEM_FIELDS).toContain("githubLinkCount");
    expect(MY_TASKS_V1_MISSING_RESPONSE_PARTS).toEqual([
      "stats",
      "scopeCounts",
      "leftoverCount",
      "leftoverSample",
    ]);
  });
});
