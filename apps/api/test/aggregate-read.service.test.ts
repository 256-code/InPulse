import { describe, expect, it, vi } from "vitest";

import type { ProjectItem } from "@inpulse/api-contract";
import type { UserReadPort } from "../src/auth/user-read.port.js";
import type { TransactionContext } from "../src/database/transaction-context.js";
import type { UnitOfWork } from "../src/database/unit-of-work.js";
import {
  AggregateReadCursorError,
  type AggregateReadCursorService,
} from "../src/modules/aggregate-read/aggregate-read-cursor.js";
import { AggregateReadError } from "../src/modules/aggregate-read/aggregate-read.errors.js";
import { MyTasksQueryService } from "../src/modules/aggregate-read/my-tasks-query.service.js";
import { ProjectOverviewQueryService } from "../src/modules/aggregate-read/project-overview-query.service.js";
import { TaskGroupMembershipQueryService } from "../src/modules/aggregate-read/task-group-membership-query.service.js";
import { TaskGroupQueryService } from "../src/modules/aggregate-read/task-group-query.service.js";
import type {
  ChangeRecordReadPort,
  MyTaskLeftoverEntry,
  MyTaskListPage,
  MyTaskListRow,
  MyTaskQueryPort,
  MyTaskStatsResult,
  TaskGroupRecordPage,
} from "../src/modules/change-records/index.js";
import type { ExternalLinksQueryPort } from "../src/modules/external-links/index.js";
import type { FeatureReadPort } from "../src/modules/features/index.js";
import type { ModuleReadPort } from "../src/modules/modules/index.js";
import type {
  ProjectAccessQueryPort,
  ProjectQueryPort,
} from "../src/modules/projects/index.js";
import type { TaskGroupMembershipReadPort } from "../src/modules/task-groups/index.js";
import type {
  TaskGroupMemberRow,
  TaskGroupReadPort,
  TaskGroupReadRecord,
} from "../src/modules/task-groups/task-group-read.port.js";
import type {
  TaskQueryPort,
  TaskReadModel,
} from "../src/modules/tasks/index.js";

const baseTime = new Date("2026-09-09T02:00:00.000Z");

const unitOfWork = {
  run: async <T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> =>
    fn({} as TransactionContext),
} as unknown as UnitOfWork;

function cursorMock(options: { readonly decode?: () => number | null } = {}) {
  return {
    encode: vi.fn().mockReturnValue("cursor-next"),
    decode: vi.fn(options.decode ?? (() => null)),
  };
}

function groupFixture(
  overrides: Partial<TaskGroupReadRecord> = {},
): TaskGroupReadRecord {
  return {
    groupId: 11,
    projectId: 7,
    code: "SHOP-TG-1",
    name: "登出聚合",
    status: "ACTIVE",
    rowVersion: 3,
    createdAt: baseTime,
    closedAt: null,
    ...overrides,
  };
}

function memberFixture(
  overrides: Partial<TaskGroupMemberRow> = {},
): TaskGroupMemberRow {
  return {
    memberId: 1,
    taskId: 21,
    role: "MAIN",
    sourceKind: null,
    status: "ACTIVE",
    joinedAt: baseTime,
    detachedAt: null,
    detachReason: null,
    ...overrides,
  };
}

function taskFixture(
  taskId: number,
  overrides: Partial<TaskReadModel> = {},
): TaskReadModel {
  return {
    taskId,
    projectId: 7,
    moduleId: 3,
    featureId: 4,
    scopeType: "FEATURE",
    code: "SHOP-T-" + String(taskId),
    title: "任务 " + String(taskId),
    creatorId: 5,
    assigneeId: 5,
    workStatus: "TODO",
    lifecycleStatus: "ACTIVE",
    rowVersion: 1,
    impactFeatureIds: [],
    ...overrides,
  };
}

function taskRowFixture(
  taskId: number,
  overrides: Partial<MyTaskListRow> = {},
): MyTaskListRow {
  return {
    taskId,
    projectId: 7,
    moduleId: 3,
    featureId: 4,
    scopeType: "FEATURE",
    code: "SHOP-T-" + String(taskId),
    title: "任务 " + String(taskId),
    assigneeId: 5,
    workStatus: "TODO",
    lifecycleStatus: "ACTIVE",
    rowVersion: 1,
    createdAt: baseTime,
    updatedAt: baseTime,
    priority: "NORMAL",
    dueAt: null,
    completedAt: null,
    creatorId: 5,
    ...overrides,
  };
}

function projectFixture(id: number, name: string): ProjectItem {
  return {
    id,
    code: "P" + String(id),
    name,
    description: "项目描述",
    status: "ACTIVE",
    rowVersion: 1,
    createdBy: 5,
    createdAt: "2026-09-09T00:00:00.000Z",
    updatedAt: "2026-09-09T00:00:00.000Z",
    memberCount: 2,
  };
}

function taskGroupSetup(
  options: {
    readonly scopeProjectIds?: readonly number[];
    readonly group?: TaskGroupReadRecord;
    readonly members?: readonly TaskGroupMemberRow[];
    readonly tasks?: readonly TaskReadModel[];
    readonly counts?: readonly {
      readonly taskId: number;
      readonly count: number;
    }[];
    readonly page?: TaskGroupRecordPage;
    readonly decode?: () => number | null;
  } = {},
) {
  const getAuthorizedSearchScope = vi.fn().mockResolvedValue({
    actorUserId: 5,
    projectIds: options.scopeProjectIds ?? [7],
    isSystemAdmin: false,
  });
  const findGroupById = vi.fn().mockResolvedValue(options.group);
  const listMembers = vi.fn().mockResolvedValue(options.members ?? []);
  const listByIds = vi.fn().mockResolvedValue(options.tasks ?? []);
  const countPublishedByTask = vi.fn().mockResolvedValue(options.counts ?? []);
  const listVisibleRecordsByTaskIds = vi
    .fn()
    .mockResolvedValue(
      options.page ?? { items: [], nextRecordId: null, hasMore: false },
    );
  const listChangeRecordLinks = vi.fn().mockResolvedValue([]);
  const listUsers = vi
    .fn()
    .mockResolvedValue([{ userId: 5, name: "成员", avatarUrl: null }]);
  const cursor = cursorMock(
    options.decode === undefined ? {} : { decode: options.decode },
  );
  const service = new TaskGroupQueryService(
    { getAuthorizedSearchScope } as unknown as ProjectAccessQueryPort,
    { findGroupById, listMembers } as unknown as TaskGroupReadPort,
    { listByIds } as unknown as TaskQueryPort,
    {
      countPublishedByTask,
      listVisibleRecordsByTaskIds,
    } as unknown as ChangeRecordReadPort,
    { listByIds: listUsers } as unknown as UserReadPort,
    { listChangeRecordLinks } as unknown as ExternalLinksQueryPort,
    unitOfWork,
    cursor as unknown as AggregateReadCursorService,
  );
  return {
    service,
    cursor,
    findGroupById,
    listMembers,
    listByIds,
    countPublishedByTask,
    listVisibleRecordsByTaskIds,
    listChangeRecordLinks,
  };
}

describe("TaskGroupQueryService.getTaskGroup", () => {
  it("聚合组不存在或不在授权范围内时统一 404 且不读取成员", async () => {
    const missing = taskGroupSetup();
    await expect(
      missing.service.getTaskGroup({ actorUserId: 5, groupId: 11 }),
    ).rejects.toMatchObject({ status: 404, code: "TASK_GROUP_NOT_FOUND" });
    expect(missing.listMembers).not.toHaveBeenCalled();

    const outOfScope = taskGroupSetup({
      group: groupFixture(),
      scopeProjectIds: [9],
    });
    await expect(
      outOfScope.service.getTaskGroup({ actorUserId: 5, groupId: 11 }),
    ).rejects.toBeInstanceOf(AggregateReadError);
    expect(outOfScope.listMembers).not.toHaveBeenCalled();
  });

  it("成员排序固定为主任务在前、来源任务按 joinedAt 与 taskId 升序", async () => {
    const setup = taskGroupSetup({
      group: groupFixture(),
      members: [
        memberFixture({
          memberId: 4,
          taskId: 24,
          role: "SOURCE",
          sourceKind: "ACTIVE",
          status: "DETACHED",
          joinedAt: new Date(baseTime.getTime() + 3000),
          detachedAt: new Date(baseTime.getTime() + 4000),
          detachReason: "拆分原因",
        }),
        memberFixture({
          memberId: 3,
          taskId: 23,
          role: "SOURCE",
          sourceKind: "ACTIVE",
          joinedAt: new Date(baseTime.getTime() + 2000),
        }),
        memberFixture({
          memberId: 2,
          taskId: 22,
          role: "SOURCE",
          sourceKind: "ACTIVE",
          joinedAt: new Date(baseTime.getTime() + 2000),
        }),
        memberFixture({ joinedAt: baseTime }),
      ],
      tasks: [
        taskFixture(21),
        taskFixture(22, { scopeType: "MODULE", featureId: null }),
        taskFixture(23),
        taskFixture(24),
      ],
      counts: [{ taskId: 21, count: 2 }],
    });

    const result = await setup.service.getTaskGroup({
      actorUserId: 5,
      groupId: 11,
    });

    expect(result.group).toEqual({
      groupId: 11,
      projectId: 7,
      code: "SHOP-TG-1",
      name: "登出聚合",
      status: "ACTIVE",
      createdAt: baseTime.toISOString(),
      closedAt: null,
      rowVersion: 3,
    });
    expect(result.members.map((item) => item.taskId)).toEqual([21, 22, 23, 24]);
    expect(result.members[0]).toMatchObject({
      taskId: 21,
      role: "MAIN",
      sourceKind: null,
      memberStatus: "ACTIVE",
      publishedRecordCount: 2,
      featureId: 4,
      assignee: { userId: 5, name: "成员", avatarUrl: null },
      joinedAt: baseTime.toISOString(),
      detachedAt: null,
    });
    expect(result.members[1]!.role).toBe("SOURCE");
    expect(result.members[1]!.featureId).toBeNull();
    expect(result.members[1]!.publishedRecordCount).toBe(0);
    expect(result.members[3]).toMatchObject({
      taskId: 24,
      memberStatus: "DETACHED",
      detachReason: "拆分原因",
    });
    expect(result.members[3]!.detachedAt).toBe(
      new Date(baseTime.getTime() + 4000).toISOString(),
    );
  });

  it("成员任务或负责人缺失时以 500 失败而不是静默丢行", async () => {
    const setup = taskGroupSetup({
      group: groupFixture(),
      members: [memberFixture({ taskId: 99 })],
      tasks: [],
    });
    await expect(
      setup.service.getTaskGroup({ actorUserId: 5, groupId: 11 }),
    ).rejects.toMatchObject({
      status: 500,
      code: "AGGREGATE_READ_INCONSISTENT",
    });
  });
});
describe("TaskGroupQueryService.listTaskGroupRecords", () => {
  it("记录列表按成员任务过滤，游标绑定组与成员筛选", async () => {
    const setup = taskGroupSetup({
      group: groupFixture(),
      members: [
        memberFixture({ memberId: 1, taskId: 21 }),
        memberFixture({
          memberId: 2,
          taskId: 22,
          role: "SOURCE",
          sourceKind: "ACTIVE",
        }),
      ],
      tasks: [
        taskFixture(21),
        taskFixture(22, { scopeType: "MODULE", featureId: null }),
      ],
      page: {
        items: [
          {
            recordId: 501,
            code: "SHOP-CR-1",
            title: "记录一",
            status: "PUBLISHED",
            taskId: 21,
            featureId: null,
            publishedAt: baseTime,
          },
          {
            recordId: 500,
            code: "SHOP-CR-2",
            title: "记录二",
            status: "VOID",
            taskId: 22,
            featureId: 4,
            publishedAt: baseTime,
          },
        ],
        nextRecordId: 500,
        hasMore: true,
      },
    });

    const result = await setup.service.listTaskGroupRecords({
      actorUserId: 5,
      groupId: 11,
      limit: 2,
    });

    expect(result.items.map((item) => item.sourceLabel)).toEqual([
      "主任务",
      "SHOP-T-22",
    ]);
    expect(result.items[0]).toMatchObject({
      recordId: 501,
      recordStatus: "PUBLISHED",
      taskId: 21,
      featureId: null,
      externalLinks: [],
      publishedAt: baseTime.toISOString(),
    });
    expect(result.items[1]!.recordStatus).toBe("VOID");
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe("cursor-next");
    expect(setup.listVisibleRecordsByTaskIds).toHaveBeenCalledWith(
      expect.anything(),
      { projectId: 7, taskIds: [21, 22], limit: 2 },
    );
    expect(setup.cursor.encode).toHaveBeenCalledWith({
      actorUserId: 5,
      namespace: "TASK_GROUP_RECORDS",
      filterKey: "TASK_GROUP_RECORDS:11:all",
      afterId: 500,
    });
  });

  it("memberTaskId 不在组内时返回空页且不报 404", async () => {
    const setup = taskGroupSetup({
      group: groupFixture(),
      members: [memberFixture({ taskId: 21 })],
    });
    const result = await setup.service.listTaskGroupRecords({
      actorUserId: 5,
      groupId: 11,
      memberTaskId: 999,
    });
    expect(result.items).toEqual([]);
    expect(result.nextCursor).toBeNull();
    expect(setup.listVisibleRecordsByTaskIds).toHaveBeenCalledWith(
      expect.anything(),
      { projectId: 7, taskIds: [], limit: 20 },
    );
    expect(setup.cursor.decode).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        actorUserId: 5,
        namespace: "TASK_GROUP_RECORDS",
        filterKey: "TASK_GROUP_RECORDS:11:999",
      }),
    );
  });

  it("越权时统一 404，非法游标映射 422", async () => {
    const outOfScope = taskGroupSetup({
      group: groupFixture(),
      scopeProjectIds: [9],
    });
    await expect(
      outOfScope.service.listTaskGroupRecords({ actorUserId: 5, groupId: 11 }),
    ).rejects.toMatchObject({ status: 404, code: "TASK_GROUP_NOT_FOUND" });
    expect(outOfScope.listVisibleRecordsByTaskIds).not.toHaveBeenCalled();

    const badCursor = taskGroupSetup({
      group: groupFixture(),
      decode: () => {
        throw new AggregateReadCursorError("signature", "bad");
      },
    });
    await expect(
      badCursor.service.listTaskGroupRecords({ actorUserId: 5, groupId: 11 }),
    ).rejects.toMatchObject({ status: 422, code: "INVALID_CURSOR" });
  });
});

type OverviewRecentRecord = Awaited<
  ReturnType<ChangeRecordReadPort["listRecentPublished"]>
>[number];

type OverviewLeftover = Awaited<
  ReturnType<ChangeRecordReadPort["listActiveLeftovers"]>
>[number];

function overviewSetup(
  options: {
    readonly scopeProjectIds?: readonly number[];
    readonly project?: ProjectItem;
    readonly excludedTaskIds?: readonly number[];
    readonly recentRecords?: readonly OverviewRecentRecord[];
    readonly leftovers?: readonly OverviewLeftover[];
  } = {},
) {
  const getAuthorizedSearchScope = vi.fn().mockResolvedValue({
    actorUserId: 5,
    projectIds: options.scopeProjectIds ?? [7],
    isSystemAdmin: false,
  });
  const find = vi
    .fn()
    .mockResolvedValue(options.project ?? projectFixture(7, "商城系统"));
  const modulesCount = vi.fn().mockResolvedValue(2);
  const featuresCount = vi.fn().mockResolvedValue(1);
  const tasksCount = vi.fn().mockResolvedValue(3);
  const countPublished = vi.fn().mockResolvedValue(4);
  const listRecentPublished = vi
    .fn()
    .mockResolvedValue(options.recentRecords ?? []);
  const listActiveLeftovers = vi
    .fn()
    .mockResolvedValue(options.leftovers ?? []);
  const countActiveLeftovers = vi.fn().mockResolvedValue(2);
  const listHistoricalSourceTaskIds = vi
    .fn()
    .mockResolvedValue(options.excludedTaskIds ?? [90]);
  const service = new ProjectOverviewQueryService(
    { getAuthorizedSearchScope } as unknown as ProjectAccessQueryPort,
    { find } as unknown as ProjectQueryPort,
    { count: modulesCount } as unknown as ModuleReadPort,
    { count: featuresCount } as unknown as FeatureReadPort,
    { count: tasksCount } as unknown as TaskQueryPort,
    {
      countPublished,
      listRecentPublished,
      listActiveLeftovers,
      countActiveLeftovers,
    } as unknown as ChangeRecordReadPort,
    { listHistoricalSourceTaskIds } as unknown as TaskGroupMembershipReadPort,
    unitOfWork,
  );
  return {
    service,
    find,
    modulesCount,
    featuresCount,
    tasksCount,
    countPublished,
    listRecentPublished,
    listActiveLeftovers,
    countActiveLeftovers,
    listHistoricalSourceTaskIds,
  };
}

describe("ProjectOverviewQueryService.getOverview", () => {
  it("非成员或项目缺失统一 404，且不读取任何统计", async () => {
    const outOfScope = overviewSetup({ scopeProjectIds: [9] });
    await expect(
      outOfScope.service.getOverview({ actorUserId: 5, projectId: 7 }),
    ).rejects.toMatchObject({ status: 404, code: "PROJECT_NOT_FOUND" });
    expect(outOfScope.find).not.toHaveBeenCalled();
    expect(outOfScope.modulesCount).not.toHaveBeenCalled();

    const missing = overviewSetup();
    missing.find.mockResolvedValue(undefined);
    await expect(
      missing.service.getOverview({ actorUserId: 5, projectId: 7 }),
    ).rejects.toBeInstanceOf(AggregateReadError);
    expect(missing.modulesCount).not.toHaveBeenCalled();
  });

  it("统计口径与默认列表条数按服务端固定默认值", async () => {
    const publishedAt = new Date("2026-09-09T03:00:00.000Z");
    const createdAt = new Date("2026-09-09T04:00:00.000Z");
    const setup = overviewSetup({
      excludedTaskIds: [90],
      recentRecords: [
        {
          recordId: 41,
          projectId: 7,
          moduleId: 3,
          featureId: null,
          code: "SHOP-CR-41",
          title: "迭代",
          currentVersion: 2,
          publishedAt,
          featureName: null,
        },
      ],
      leftovers: [
        {
          leftoverItemId: 9,
          recordId: 41,
          recordCode: "SHOP-CR-41",
          recordTitle: "迭代记录标题",
          projectId: 7,
          content: "遗留",
          createdAt,
        },
      ],
    });

    const result = await setup.service.getOverview({
      actorUserId: 5,
      projectId: 7,
    });

    expect(result.project).toEqual({
      projectId: 7,
      name: "商城系统",
      status: "ACTIVE",
    });
    expect(result.memberCount).toBe(2);
    expect(result.stats).toEqual({
      activeModuleCount: 2,
      activeFeatureCount: 1,
      openTaskCount: 3,
      publishedRecordCount: 4,
    });
    expect(result.recentRecords).toEqual([
      {
        recordId: 41,
        code: "SHOP-CR-41",
        title: "迭代",
        moduleId: 3,
        featureId: null,
        featureName: null,
        publishedAt: publishedAt.toISOString(),
      },
    ]);
    expect(result.activeLeftoverTotal).toBe(2);
    expect(result.activeLeftovers).toEqual([
      {
        leftoverItemId: 9,
        recordId: 41,
        recordCode: "SHOP-CR-41",
        recordTitle: "迭代记录标题",
        content: "遗留",
        createdAt: createdAt.toISOString(),
      },
    ]);
    expect(setup.modulesCount).toHaveBeenCalledWith(expect.anything(), {
      projectId: 7,
      status: "ACTIVE",
    });
    expect(setup.featuresCount).toHaveBeenCalledWith(expect.anything(), {
      projectId: 7,
      status: "ACTIVE",
    });
    expect(setup.tasksCount).toHaveBeenCalledWith(expect.anything(), {
      projectIds: [7],
      workStatuses: ["TODO"],
      effectiveOnly: true,
      excludedTaskIds: [90],
    });
    expect(setup.countPublished).toHaveBeenCalledWith(expect.anything(), {
      projectId: 7,
    });
    expect(setup.listRecentPublished).toHaveBeenCalledWith(expect.anything(), {
      projectId: 7,
      limit: 3,
    });
    expect(setup.listActiveLeftovers).toHaveBeenCalledWith(expect.anything(), {
      projectId: 7,
      limit: 2,
    });
    expect(setup.countActiveLeftovers).toHaveBeenCalledWith(expect.anything(), {
      projectId: 7,
    });
  });

  it("显式列表条数直接透传", async () => {
    const setup = overviewSetup();
    await setup.service.getOverview({
      actorUserId: 5,
      projectId: 7,
      recentRecordLimit: 10,
      activeLeftoverLimit: 1,
    });
    expect(setup.listRecentPublished).toHaveBeenCalledWith(expect.anything(), {
      projectId: 7,
      limit: 10,
    });
    expect(setup.listActiveLeftovers).toHaveBeenCalledWith(expect.anything(), {
      projectId: 7,
      limit: 1,
    });
  });
});
function myTasksSetup(
  options: {
    readonly scopeProjectIds?: readonly number[];
    readonly page?: MyTaskListPage;
    readonly stats?: MyTaskStatsResult;
    readonly leftover?: MyTaskLeftoverEntry;
    readonly linkCounts?: readonly {
      readonly taskId: number;
      readonly count: number;
    }[];
    readonly decode?: () => number | null;
    readonly projects?: readonly ProjectItem[];
    readonly moduleNames?: readonly {
      readonly moduleId: number;
      readonly projectId: number;
      readonly name: string;
    }[];
    readonly featureNames?: readonly {
      readonly featureId: number;
      readonly projectId: number;
      readonly moduleId: number;
      readonly name: string;
    }[];
    readonly publishedTaskIds?: readonly number[];
    readonly groupRoles?: readonly {
      readonly taskId: number;
      readonly groupId: number;
      readonly role: "MAIN" | "SOURCE";
    }[];
  } = {},
) {
  const getAuthorizedSearchScope = vi.fn().mockResolvedValue({
    actorUserId: 5,
    projectIds: options.scopeProjectIds ?? [7],
    isSystemAdmin: false,
  });
  const listPage = vi
    .fn()
    .mockResolvedValue(
      options.page ?? { items: [], nextTaskId: null, hasMore: false },
    );
  const listProjects = vi
    .fn()
    .mockResolvedValue(options.projects ?? [projectFixture(7, "商城系统")]);
  const listModuleNames = vi
    .fn()
    .mockResolvedValue(
      options.moduleNames ?? [{ moduleId: 3, projectId: 7, name: "模块" }],
    );
  const listFeatureNames = vi
    .fn()
    .mockResolvedValue(
      options.featureNames ?? [
        { featureId: 4, projectId: 7, moduleId: 3, name: "功能" },
      ],
    );
  const listTaskIdsWithPublishedRecords = vi
    .fn()
    .mockResolvedValue(options.publishedTaskIds ?? [501]);
  const listHistoricalSourceTaskIds = vi.fn().mockResolvedValue([90]);
  const listGroupRoles = vi.fn().mockResolvedValue(options.groupRoles ?? []);
  const countTaskLinks = vi
    .fn()
    .mockResolvedValue(options.linkCounts ?? [{ taskId: 501, count: 3 }]);
  const stats = vi.fn().mockResolvedValue(
    options.stats ?? {
      myOpen: 4,
      dueToday: 1,
      overdue: 2,
      completedThisMonth: 3,
    },
  );
  const leftoverEntry = vi.fn().mockResolvedValue(
    options.leftover ?? {
      count: 2,
      sample: {
        recordCode: "SHOP-CR-41",
        contentPrefix: "最新遗留内容",
        truncated: false,
      },
    },
  );
  const listUsers = vi
    .fn()
    .mockResolvedValue([{ userId: 5, name: "成员", avatarUrl: null }]);
  const cursor = cursorMock(
    options.decode === undefined ? {} : { decode: options.decode },
  );
  const service = new MyTasksQueryService(
    { getAuthorizedSearchScope } as unknown as ProjectAccessQueryPort,
    { list: listProjects } as unknown as ProjectQueryPort,
    { list: listPage, stats, leftoverEntry } as unknown as MyTaskQueryPort,
    { listNames: listModuleNames } as unknown as ModuleReadPort,
    { listNames: listFeatureNames } as unknown as FeatureReadPort,
    { listTaskIdsWithPublishedRecords } as unknown as ChangeRecordReadPort,
    { countTaskLinks } as unknown as ExternalLinksQueryPort,
    {
      listHistoricalSourceTaskIds,
      listGroupRoles,
    } as unknown as TaskGroupMembershipReadPort,
    { listByIds: listUsers } as unknown as UserReadPort,
    unitOfWork,
    cursor as unknown as AggregateReadCursorService,
  );
  return {
    service,
    cursor,
    listPage,
    listProjects,
    listHistoricalSourceTaskIds,
    listGroupRoles,
    countTaskLinks,
    stats,
    leftoverEntry,
  };
}

describe("MyTasksQueryService.list", () => {
  it("越权 projectId 收敛为空页而不是 404", async () => {
    const setup = myTasksSetup({ scopeProjectIds: [7] });
    const result = await setup.service.list({ actorUserId: 5, projectId: 9 });
    expect(result).toEqual({
      items: [],
      nextCursor: null,
      hasMore: false,
      stats: { myOpen: 4, dueToday: 1, overdue: 2, completedThisMonth: 3 },
      leftoverCount: 2,
      leftoverSample: { recordCode: "SHOP-CR-41", summary: "最新遗留内容" },
    });
    expect(setup.listPage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ projectIds: [] }),
    );
    expect(setup.stats).toHaveBeenCalledWith(expect.anything(), {
      projectIds: [],
      assigneeId: 5,
      excludedTaskIds: [90],
    });
  });

  it("六项筛选进入端口与游标 filterKey，includeCanceled 并入 CANCELED", async () => {
    const setup = myTasksSetup({ scopeProjectIds: [7, 9] });
    await setup.service.list({
      actorUserId: 5,
      projectId: 9,
      scopeType: "MODULE",
      workStatus: "TODO",
      hasPublishedRecord: false,
      priority: "HIGH",
      includeCanceled: true,
      limit: 5,
    });
    expect(setup.cursor.decode).toHaveBeenCalledWith(undefined, {
      actorUserId: 5,
      namespace: "MY_TASKS",
      filterKey: JSON.stringify([9, "MODULE", "TODO", false, "HIGH", true]),
    });
    expect(setup.listPage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectIds: [9],
        assigneeId: 5,
        limit: 5,
        excludedTaskIds: [90],
        workStatuses: ["TODO", "CANCELED"],
        scopeTypes: ["MODULE"],
        hasPublishedRecord: false,
        priority: "HIGH",
      }),
    );
  });

  it("includeCanceled 在 workStatus 缺省时不产生额外过滤", async () => {
    const setup = myTasksSetup();
    await setup.service.list({ actorUserId: 5, includeCanceled: true });
    expect(setup.listPage.mock.calls[0]?.[1]).not.toHaveProperty(
      "workStatuses",
    );
  });

  it("条目映射 groupRole 与 hasPublishedRecord 并签发下一页游标", async () => {
    const setup = myTasksSetup({
      page: {
        items: [taskRowFixture(502, { featureId: null }), taskRowFixture(501)],
        nextTaskId: 501,
        hasMore: true,
      },
      publishedTaskIds: [501],
      groupRoles: [{ taskId: 501, groupId: 11, role: "MAIN" }],
    });

    const result = await setup.service.list({ actorUserId: 5 });

    expect(result.items[0]).toMatchObject({
      taskId: 502,
      featureId: null,
      featureName: null,
      projectName: "商城系统",
      moduleName: "模块",
      priority: "NORMAL",
      dueAt: null,
      completedAt: null,
      creatorId: 5,
      githubLinkCount: 0,
      hasPublishedRecord: false,
      groupRole: null,
      groupId: null,
      updatedAt: baseTime.toISOString(),
    });
    expect(result.items[1]).toMatchObject({
      taskId: 501,
      featureName: "功能",
      hasPublishedRecord: true,
      githubLinkCount: 3,
      groupRole: "MAIN",
      groupId: 11,
    });
    expect(result.stats).toEqual({
      myOpen: 4,
      dueToday: 1,
      overdue: 2,
      completedThisMonth: 3,
    });
    expect(result.leftoverCount).toBe(2);
    expect(result.leftoverSample).toEqual({
      recordCode: "SHOP-CR-41",
      summary: "最新遗留内容",
    });
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe("cursor-next");
    expect(setup.cursor.encode).toHaveBeenCalledWith({
      actorUserId: 5,
      namespace: "MY_TASKS",
      filterKey: JSON.stringify([null, null, null, null, null, null]),
      afterId: 501,
    });
  });

  it("非法游标映射为 422 INVALID_CURSOR", async () => {
    const setup = myTasksSetup({
      decode: () => {
        throw new AggregateReadCursorError("expired", "gone");
      },
    });
    await expect(setup.service.list({ actorUserId: 5 })).rejects.toMatchObject({
      status: 422,
      code: "INVALID_CURSOR",
    });
  });

  it("截止与完成时间按 ISO 返回，统计与遗留样例按基准集合透传并截断", async () => {
    const dueAt = new Date("2026-09-10T04:00:00.000Z");
    const completedAt = new Date("2026-09-08T04:00:00.000Z");
    const setup = myTasksSetup({
      page: {
        items: [
          taskRowFixture(501, {
            workStatus: "DONE",
            dueAt,
            completedAt,
          }),
        ],
        nextTaskId: null,
        hasMore: false,
      },
      stats: {
        myOpen: 0,
        dueToday: 0,
        overdue: 0,
        completedThisMonth: 1,
      },
      leftover: {
        count: 1,
        sample: {
          recordCode: "SHOP-CR-41",
          contentPrefix: "遗留内容".repeat(50),
          truncated: true,
        },
      },
    });
    const result = await setup.service.list({ actorUserId: 5 });
    expect(result.items[0]).toMatchObject({
      workStatus: "DONE",
      dueAt: dueAt.toISOString(),
      completedAt: completedAt.toISOString(),
    });
    expect(result.stats).toEqual({
      myOpen: 0,
      dueToday: 0,
      overdue: 0,
      completedThisMonth: 1,
    });
    expect(result.leftoverCount).toBe(1);
    expect(result.leftoverSample).toEqual({
      recordCode: "SHOP-CR-41",
      summary: "遗留内容".repeat(50) + "…",
    });
    expect(setup.stats).toHaveBeenCalledWith(expect.anything(), {
      projectIds: [7],
      assigneeId: 5,
      excludedTaskIds: [90],
    });
    expect(setup.leftoverEntry).toHaveBeenCalledWith(expect.anything(), {
      projectIds: [7],
      assigneeId: 5,
      excludedTaskIds: [90],
    });
    expect(setup.countTaskLinks).toHaveBeenCalledWith(
      expect.anything(),
      [7],
      [501],
    );
  });

  it("条目缺少项目或模块时以 500 失败而不是静默丢行", async () => {
    const setup = myTasksSetup({
      page: {
        items: [taskRowFixture(501)],
        nextTaskId: null,
        hasMore: false,
      },
      projects: [],
    });
    await expect(setup.service.list({ actorUserId: 5 })).rejects.toMatchObject({
      status: 500,
      code: "AGGREGATE_READ_INCONSISTENT",
    });
  });
});

describe("TaskGroupMembershipQueryService.list", () => {
  function membershipSetup(
    options: {
      readonly scopeProjectIds?: readonly number[];
      readonly roles?: readonly {
        readonly taskId: number;
        readonly groupId: number;
        readonly role: "MAIN" | "SOURCE";
      }[];
    } = {},
  ) {
    const getAuthorizedSearchScope = vi.fn().mockResolvedValue({
      actorUserId: 5,
      projectIds: options.scopeProjectIds ?? [7],
      isSystemAdmin: false,
    });
    const listGroupRoles = vi.fn().mockResolvedValue(options.roles ?? []);
    const service = new TaskGroupMembershipQueryService(
      { getAuthorizedSearchScope } as unknown as ProjectAccessQueryPort,
      { listGroupRoles } as unknown as TaskGroupMembershipReadPort,
      unitOfWork,
    );
    return { service, getAuthorizedSearchScope, listGroupRoles };
  }

  it("按服务端授权范围读取 ACTIVE 组关系并固定 taskId 升序", async () => {
    const setup = membershipSetup({
      roles: [
        { taskId: 22, groupId: 12, role: "SOURCE" },
        { taskId: 21, groupId: 11, role: "MAIN" },
      ],
    });
    const result = await setup.service.list({
      actorUserId: 5,
      taskIds: [22, 21],
    });
    expect(result).toEqual({
      items: [
        { taskId: 21, groupId: 11, groupRole: "MAIN" },
        { taskId: 22, groupId: 12, groupRole: "SOURCE" },
      ],
    });
    expect(setup.listGroupRoles).toHaveBeenCalledWith(
      expect.anything(),
      [7],
      [22, 21],
    );
  });

  it("无授权项目时返回空结果且不发出 SQL", async () => {
    const setup = membershipSetup({ scopeProjectIds: [] });
    const result = await setup.service.list({
      actorUserId: 5,
      taskIds: [999],
    });
    expect(result).toEqual({ items: [] });
    expect(setup.listGroupRoles).toHaveBeenCalledWith(
      expect.anything(),
      [],
      [999],
    );
  });
});
