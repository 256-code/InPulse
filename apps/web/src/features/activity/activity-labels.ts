import type { ActivityItem } from "@generated/api";

/**
 * 项目动态的分类筛选项，取值与设计师稿 `activity.tsx` 的 chip 行一致。
 * 服务端 `sourceEntityType` 比这八项更细（另有任务组与遗留问题），
 * 它们分别归入「任务」与「迭代记录」，与设计师稿的语义保持一致。
 */
export const ACTIVITY_CHIPS = [
  "全部",
  "任务",
  "迭代记录",
  "功能",
  "模块",
  "项目",
  "成员",
  "GitHub",
] as const;

export type ActivityChip = (typeof ACTIVITY_CHIPS)[number];

const ENTITY_LABELS: Readonly<Record<string, string>> = {
  PROJECT: "项目",
  MODULE: "模块",
  FEATURE: "功能",
  TASK: "任务",
  TASK_GROUP: "任务组",
  CHANGE_RECORD: "迭代记录",
  EXTERNAL_LINK: "GitHub",
  LEFTOVER_ITEM: "遗留问题",
};

/**
 * 服务端 `activityType` 的中文动作标签。
 * 后端存在两种命名风格：项目与迭代记录生命周期用 UPPER_SNAKE
 * （`PROJECT_CREATED`、`CHANGE_RECORD_VOIDED`），
 * 模块 / 功能 / 任务 / 记录草稿用 dot.case（`task.create`、`record.publish`）。
 * 未收录的取值按原样显示，便于在界面上直接发现新的后端事件。
 */
const ACTION_LABELS: Readonly<Record<string, string>> = {
  PROJECT_CREATED: "创建项目",
  PROJECT_UPDATED: "更新项目",
  PROJECT_ARCHIVED: "归档项目",
  PROJECT_RESTORED: "恢复项目",
  PROJECT_MEMBER_ADDED: "添加成员",
  PROJECT_MEMBER_REMOVED: "移除成员",
  "module.create": "创建模块",
  "module.update": "更新模块",
  "module.archive": "归档模块",
  "module.restore": "恢复模块",
  "feature.create": "创建功能",
  "feature.update": "更新功能",
  "feature.archive": "归档功能",
  "feature.restore": "恢复功能",
  "task.create": "创建任务",
  "task.update": "更新任务",
  "task.complete": "完成任务",
  "task.reopen": "重新打开任务",
  "task.cancel": "取消任务",
  "task.restore": "恢复任务",
  "task.archive": "归档任务",
  "task.unarchive": "恢复任务",
  TASK_ARCHIVED: "归档任务",
  TASK_RESTORED: "恢复任务",
  "task.merge": "合并任务",
  "task.unmerge": "解除合并",
  "record.publish": "发布记录",
  "record.version.create": "修订记录",
  "record.draft.create": "创建草稿",
  "record.draft.update": "更新草稿",
  "leftover.convert": "遗留问题转任务",
  PROJECT_ARCHIVE_REQUESTED: "申请归档项目",
  PROJECT_ARCHIVE_REJECTED: "驳回归档申请",
  CHANGE_RECORD_VOIDED: "作废记录",
  CHANGE_RECORD_RESTORED: "恢复记录",
  EXTERNAL_LINK_ADDED: "添加 GitHub 关联",
  EXTERNAL_LINK_REMOVED: "解除 GitHub 关联",
  // 早期演示数据里的历史取值
  PROJECT_JOINED: "加入项目",
  TASK_COMPLETED: "完成任务",
  TASK_ASSIGNED: "指派任务",
};

export function activityActionLabel(activityType: string): string {
  return ACTION_LABELS[activityType] ?? activityType;
}

export function activityEntityLabel(sourceEntityType: string): string {
  return ENTITY_LABELS[sourceEntityType] ?? sourceEntityType;
}

function activityChipOf(item: ActivityItem): ActivityChip {
  if (item.activityType.startsWith("EXTERNAL_LINK")) {
    return "GitHub";
  }
  if (item.activityType.startsWith("PROJECT_MEMBER")) {
    return "成员";
  }
  switch (item.sourceEntityType) {
    case "TASK":
    case "TASK_GROUP":
      return "任务";
    case "CHANGE_RECORD":
    case "LEFTOVER_ITEM":
      return "迭代记录";
    case "FEATURE":
      return "功能";
    case "MODULE":
      return "模块";
    default:
      return "项目";
  }
}

export function matchesActivityChip(
  item: ActivityItem,
  chip: ActivityChip,
): boolean {
  return chip === "全部" || activityChipOf(item) === chip;
}

const SUBJECT_PREFIX_MAX_LENGTH = 16;

/**
 * 服务端摘要统一是「动作：对象标题」（`任务完成：F-01 用户登录与会话管理 交付`）。
 * 设计师稿把动作与对象分成两行，这里只取冒号后的对象标题；
 * 摘要不含前缀时原样返回，避免截断历史数据。
 */
export function activitySubject(summary: string): string {
  const index = summary.indexOf("：");
  if (index <= 0 || index > SUBJECT_PREFIX_MAX_LENGTH) {
    return summary;
  }
  return summary.slice(index + 1).trim() || summary;
}

export interface ActivityTargetOptions {
  readonly isAdmin: boolean;
}

/**
 * 「查看对象」的落点。活动投影只有对象类型与对象 ID，没有模块 / 功能归属，
 * 所以任务与模块只能落到项目级列表；迭代记录与遗留问题走记录页的 `recordId` 定位；
 * 成员变更只有管理员能打开成员管理页。
 */
export function activityTargetPath(
  item: ActivityItem,
  options: ActivityTargetOptions,
): string {
  const projectId = item.projectId;
  if (item.activityType.startsWith("PROJECT_MEMBER")) {
    return options.isAdmin
      ? `/projects/${projectId}/members`
      : `/projects/${projectId}/modules`;
  }
  switch (item.sourceEntityType) {
    case "CHANGE_RECORD":
      return `/records?recordId=${item.sourceEntityId}`;
    case "LEFTOVER_ITEM":
      return "/records";
    case "MODULE":
    case "FEATURE":
      return `/projects/${projectId}/modules`;
    case "TASK":
    case "TASK_GROUP":
      return `/tasks?project=${projectId}`;
    default:
      return `/projects/${projectId}/modules`;
  }
}

export function activityTargetLabel(item: ActivityItem): string {
  return `${activityEntityLabel(item.sourceEntityType)} #${item.sourceEntityId}`;
}
