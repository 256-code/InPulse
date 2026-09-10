import type {
  MyTaskListItem,
  MyTaskListResult,
  MyTaskPriority,
  MyTaskStats,
  MyTasksAdapter,
  MyTasksQueryInput,
  MyTaskWorkStatus,
} from "./my-tasks-types";
import {
  isBeforeTodayIso,
  isSameDayIso,
  isSameMonthIso,
} from "./my-tasks-time";

/**
 * 骨架阶段 mock 数据集内置的示例用户；接口冻结前，真实会话 id 不参与过滤，
 * 页面始终以该示例视角演示，避免真实用户 id 与演示数据不匹配导致空列表。
 */
export const MY_TASKS_MOCK_VIEWER_ID = 1;

export const MY_TASKS_MOCK_NOTICE =
  "任务中心骨架：任务、统计与遗留问题来自前端 mock adapter，尚未接入服务端聚合接口；接口冻结后只替换 adapter 实现，页面结构不变。";

type Bucket = "open" | "done" | "canceled";

const bucketRank: Record<Bucket, number> = { open: 0, done: 1, canceled: 2 };

const priorityRank: Record<MyTaskPriority, number> = {
  URGENT: 0,
  HIGH: 1,
  NORMAL: 2,
  LOW: 3,
};

function startOfDay(offsetDays: number, hour = 10): string {
  const now = new Date();
  const day = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + offsetDays,
    hour,
    0,
    0,
    0,
  );
  return day.toISOString();
}

function dayOfMonth(offsetDays: number): string {
  const now = new Date();
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    1 + offsetDays,
    9,
    0,
    0,
    0,
  ).toISOString();
}

function bucketOf(status: MyTaskWorkStatus): Bucket {
  if (status === "TODO") return "open";
  if (status === "DONE") return "done";
  return "canceled";
}

function createMockItems(): readonly MyTaskListItem[] {
  return [
    {
      taskId: 101,
      code: "T-101",
      title: "登录页缺少恢复码入口，管理员无法自助找回",
      description:
        "恢复码入口只在注册流程出现，登录页没有入口，也没有说明文案。",
      projectId: 1,
      projectName: "InPulse 平台",
      moduleId: 11,
      moduleName: "访问控制",
      featureId: 111,
      featureName: "MFA 登录",
      scopeType: "FEATURE",
      workStatus: "TODO",
      lifecycleStatus: "ACTIVE",
      priority: "URGENT",
      dueAt: startOfDay(-2),
      updatedAt: startOfDay(-1),
      completedAt: null,
      creatorId: 1,
      assignee: { userId: 1, name: "陈晓", avatarUrl: null },
      hasPublishedRecord: false,
      groupRole: null,
      githubLinkCount: 1,
    },
    {
      taskId: 102,
      code: "T-102",
      title: "任务合并后来源分支的历史记录仍可回溯",
      description:
        "合并只改变入口，不改写历史；需要确认来源分支记录仍可按原任务检索。",
      projectId: 1,
      projectName: "InPulse 平台",
      moduleId: 12,
      moduleName: "任务与聚合",
      featureId: 121,
      featureName: "任务合并",
      scopeType: "MODULE",
      workStatus: "TODO",
      lifecycleStatus: "ACTIVE",
      priority: "HIGH",
      dueAt: startOfDay(0),
      updatedAt: startOfDay(0, 8),
      completedAt: null,
      creatorId: 1,
      assignee: { userId: 1, name: "陈晓", avatarUrl: null },
      hasPublishedRecord: true,
      groupRole: "MAIN",
      githubLinkCount: 0,
    },
    {
      taskId: 103,
      code: "T-103",
      title: "搜索短词命中率复核（中文两字词）",
      description: "复核 PGroonga 默认计划下两字中文词的召回与耗时。",
      projectId: 2,
      projectName: "订单中台",
      moduleId: 21,
      moduleName: "检索",
      featureId: 211,
      featureName: "全局搜索",
      scopeType: "FEATURE",
      workStatus: "TODO",
      lifecycleStatus: "ACTIVE",
      priority: "NORMAL",
      dueAt: startOfDay(5),
      updatedAt: startOfDay(-1, 15),
      completedAt: null,
      creatorId: 1,
      assignee: { userId: 1, name: "陈晓", avatarUrl: null },
      hasPublishedRecord: false,
      groupRole: null,
      githubLinkCount: 0,
    },
    {
      taskId: 104,
      code: "T-104",
      title: "通知铃铛未读计数与列表联动",
      description: "已读操作后未读计数需要与列表同步刷新。",
      projectId: 1,
      projectName: "InPulse 平台",
      moduleId: 13,
      moduleName: "通知",
      featureId: 131,
      featureName: "站内通知",
      scopeType: "FEATURE",
      workStatus: "DONE",
      lifecycleStatus: "ACTIVE",
      priority: "NORMAL",
      dueAt: dayOfMonth(3),
      updatedAt: dayOfMonth(4),
      completedAt: dayOfMonth(4),
      creatorId: 1,
      assignee: { userId: 1, name: "陈晓", avatarUrl: null },
      hasPublishedRecord: true,
      groupRole: null,
      githubLinkCount: 1,
    },
    {
      taskId: 105,
      code: "T-105",
      title: "项目成员移除前的未完成任务提示文案",
      description: "移除成员前需要展示其未完成任务，并给出改派入口。",
      projectId: 2,
      projectName: "订单中台",
      moduleId: 22,
      moduleName: "成员管理",
      featureId: null,
      featureName: null,
      scopeType: "MODULE",
      workStatus: "TODO",
      lifecycleStatus: "ACTIVE",
      priority: "HIGH",
      dueAt: startOfDay(3),
      updatedAt: startOfDay(-2, 16),
      completedAt: null,
      creatorId: 1,
      assignee: { userId: 2, name: "王敏", avatarUrl: null },
      hasPublishedRecord: false,
      groupRole: "SOURCE",
      githubLinkCount: 0,
    },
    {
      taskId: 106,
      code: "T-106",
      title: "移动端窄屏下任务卡片换行错位",
      description: "700px 以下卡片底部信息会挤压换行。",
      projectId: 3,
      projectName: "移动端体验",
      moduleId: 31,
      moduleName: "样式基线",
      featureId: 311,
      featureName: "响应式布局",
      scopeType: "FEATURE",
      workStatus: "DONE",
      lifecycleStatus: "ACTIVE",
      priority: "LOW",
      dueAt: dayOfMonth(6),
      updatedAt: dayOfMonth(2),
      completedAt: dayOfMonth(2),
      creatorId: 1,
      assignee: { userId: 1, name: "陈晓", avatarUrl: null },
      hasPublishedRecord: false,
      groupRole: null,
      githubLinkCount: 0,
    },
    {
      taskId: 107,
      code: "T-107",
      title: "旧版任务导出脚本下线",
      description: "需求取消，保留编号与历史，不物理删除。",
      projectId: 1,
      projectName: "InPulse 平台",
      moduleId: 14,
      moduleName: "数据导出",
      featureId: null,
      featureName: null,
      scopeType: "MODULE",
      workStatus: "CANCELED",
      lifecycleStatus: "ACTIVE",
      priority: "NORMAL",
      dueAt: null,
      updatedAt: dayOfMonth(5),
      completedAt: null,
      creatorId: 1,
      assignee: { userId: 1, name: "陈晓", avatarUrl: null },
      hasPublishedRecord: false,
      groupRole: null,
      githubLinkCount: 0,
    },
    {
      taskId: 108,
      code: "T-108",
      title: "任务中心 URL 筛选状态需要可分享",
      description: "筛选状态由 URL 承载，刷新与分享后保持一致。",
      projectId: 3,
      projectName: "移动端体验",
      moduleId: 32,
      moduleName: "信息架构",
      featureId: 321,
      featureName: "任务中心",
      scopeType: "FEATURE",
      workStatus: "TODO",
      lifecycleStatus: "ACTIVE",
      priority: "LOW",
      dueAt: startOfDay(20),
      updatedAt: startOfDay(-3, 11),
      completedAt: null,
      creatorId: 1,
      assignee: { userId: 1, name: "陈晓", avatarUrl: null },
      hasPublishedRecord: false,
      groupRole: null,
      githubLinkCount: 0,
    },
    {
      taskId: 109,
      code: "T-109",
      title: "审计日志导出缺少请求 ID 列",
      description: "导出列需要补齐 requestId，方便与错误响应关联。",
      projectId: 2,
      projectName: "订单中台",
      moduleId: 23,
      moduleName: "审计",
      featureId: 231,
      featureName: "审计检索",
      scopeType: "FEATURE",
      workStatus: "DONE",
      lifecycleStatus: "ACTIVE",
      priority: "HIGH",
      dueAt: startOfDay(-1),
      updatedAt: startOfDay(-1, 18),
      completedAt: startOfDay(-1, 18),
      creatorId: 1,
      assignee: { userId: 1, name: "陈晓", avatarUrl: null },
      hasPublishedRecord: true,
      groupRole: null,
      githubLinkCount: 1,
    },
    {
      taskId: 110,
      code: "T-110",
      title: "项目归档预览的未完成任务口径",
      description: "归档预览只统计真实任务，不计入已取消任务。",
      projectId: 1,
      projectName: "InPulse 平台",
      moduleId: 15,
      moduleName: "项目设置",
      featureId: null,
      featureName: null,
      scopeType: "MODULE",
      workStatus: "TODO",
      lifecycleStatus: "ACTIVE",
      priority: "NORMAL",
      dueAt: startOfDay(9),
      updatedAt: startOfDay(-4, 14),
      completedAt: null,
      creatorId: 3,
      assignee: { userId: 3, name: "赵磊", avatarUrl: null },
      hasPublishedRecord: false,
      groupRole: null,
      githubLinkCount: 0,
    },
  ];
}

function haystack(item: MyTaskListItem): string {
  return [
    item.code,
    item.title,
    item.description,
    item.projectName,
    item.moduleName,
    item.featureName ?? "",
    item.assignee.name,
  ]
    .join(" ")
    .toLowerCase();
}

function matchesScope(
  item: MyTaskListItem,
  filters: MyTasksQueryInput["filters"],
  viewerId: number,
): boolean {
  if (filters.scope === "mine") return item.assignee.userId === viewerId;
  if (filters.scope === "created") return item.creatorId === viewerId;
  if (filters.scope === "project")
    return filters.projectId === null || item.projectId === filters.projectId;
  return true;
}

function matchesFilters(
  item: MyTaskListItem,
  filters: MyTasksQueryInput["filters"],
): boolean {
  const bucket = bucketOf(item.workStatus);
  if (bucket === "canceled") {
    if (!filters.includeCanceled) return false;
    if (filters.status !== "all") return false;
  }
  if (filters.status === "open" && item.workStatus !== "TODO") return false;
  if (filters.status === "done" && item.workStatus !== "DONE") return false;
  if (filters.priority !== null && item.priority !== filters.priority)
    return false;
  if (filters.level !== null && item.scopeType !== filters.level) return false;
  if (filters.relation === "STANDALONE" && item.groupRole !== null)
    return false;
  if (filters.relation === "MAIN" && item.groupRole !== "MAIN") return false;
  if (filters.relation === "SOURCE" && item.groupRole !== "SOURCE")
    return false;
  if (filters.hasRecord === "yes" && !item.hasPublishedRecord) return false;
  if (filters.hasRecord === "no" && item.hasPublishedRecord) return false;
  if (filters.hasGithub === "yes" && item.githubLinkCount === 0) return false;
  if (filters.hasGithub === "no" && item.githubLinkCount > 0) return false;
  const term = filters.query.trim().toLowerCase();
  if (term.length > 0 && !haystack(item).includes(term)) return false;
  return true;
}

function compareOpen(a: MyTaskListItem, b: MyTaskListItem): number {
  const aOverdue = a.dueAt !== null && isBeforeTodayIso(a.dueAt);
  const bOverdue = b.dueAt !== null && isBeforeTodayIso(b.dueAt);
  if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
  const aToday = a.dueAt !== null && isSameDayIso(a.dueAt, 0);
  const bToday = b.dueAt !== null && isSameDayIso(b.dueAt, 0);
  if (aToday !== bToday) return aToday ? -1 : 1;
  const byPriority = priorityRank[a.priority] - priorityRank[b.priority];
  if (byPriority !== 0) return byPriority;
  return (a.dueAt ?? "9999-12-31").localeCompare(b.dueAt ?? "9999-12-31");
}

function compareClosed(a: MyTaskListItem, b: MyTaskListItem): number {
  return (b.completedAt ?? b.updatedAt).localeCompare(
    a.completedAt ?? a.updatedAt,
  );
}

function compareItems(a: MyTaskListItem, b: MyTaskListItem): number {
  const bucket = bucketOf(a.workStatus);
  const byBucket = bucketRank[bucket] - bucketRank[bucketOf(b.workStatus)];
  if (byBucket !== 0) return byBucket;
  return bucket === "open" ? compareOpen(a, b) : compareClosed(a, b);
}

function buildStats(
  scoped: readonly MyTaskListItem[],
  viewerId: number,
): MyTaskStats {
  const mine = scoped.filter((item) => item.assignee.userId === viewerId);
  return {
    myOpen: mine.filter((item) => item.workStatus === "TODO").length,
    dueToday: mine.filter(
      (item) =>
        item.workStatus === "TODO" &&
        item.dueAt !== null &&
        isSameDayIso(item.dueAt, 0),
    ).length,
    overdue: mine.filter(
      (item) =>
        item.workStatus === "TODO" &&
        item.dueAt !== null &&
        isBeforeTodayIso(item.dueAt),
    ).length,
    completedThisMonth: mine.filter(
      (item) =>
        item.workStatus === "DONE" &&
        isSameMonthIso(item.completedAt ?? item.updatedAt),
    ).length,
  };
}

/** 惰性构造演示数据：到期日相对当前日期生成，避免注释型日期随时间漂移。 */
export function createTasksMockItems(): readonly MyTaskListItem[] {
  return createMockItems();
}

export const MY_TASKS_MOCK_ADAPTER: MyTasksAdapter = {
  source: "mock",
  notice: MY_TASKS_MOCK_NOTICE,
  fetchMyTasks: (input: MyTasksQueryInput): Promise<MyTaskListResult> => {
    const viewerId = MY_TASKS_MOCK_VIEWER_ID;
    const dataset = createMockItems();
    const scoped = dataset.filter((item) =>
      matchesScope(item, input.filters, viewerId),
    );
    const items = scoped
      .filter((item) => matchesFilters(item, input.filters))
      .slice()
      .sort(compareItems);
    return Promise.resolve({
      items,
      nextCursor: null,
      hasMore: false,
      stats: buildStats(scoped, viewerId),
      scopeCounts: {
        mine: dataset.filter((item) => item.assignee.userId === viewerId)
          .length,
        created: dataset.filter((item) => item.creatorId === viewerId).length,
        project:
          input.filters.projectId === null
            ? dataset.length
            : dataset.filter(
                (item) => item.projectId === input.filters.projectId,
              ).length,
        all: dataset.length,
      },
      leftoverCount: 3,
      leftoverSample: {
        recordCode: "R-021",
        summary: "恢复码入口与说明文档不一致，需要补齐登录页入口",
      },
    });
  },
};
