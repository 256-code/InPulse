import type { InpulseIconName } from "@features/common/components/InpulseIcon";

/**
 * 项目动态行的视觉编码（2026-10-09 用户选定，原型 activity-styles.html 方案 B）：
 * 颜色回答「发生了什么」——按动作方向把 activityType 归入 创建 / 更新 / 删除 / 状态流转：
 * 添加成员、添加 GitHub 关联等「添加/加入」类操作归 create，移除成员、解除关联等
 * 「移除/解除」类操作归 delete，变更成员角色归 update；GitHub 与成员的身份由图标形状承担。
 * 图标形状回答「这是谁的事」——sourceEntityType 映射对象图标。
 * 只做展示层映射：未收录的取值分别退回 other（中性灰）与通用 activity 图标，
 * 后端新增事件时界面不会缺样式，也能直接在界面上看出尚未归类的动作。
 */
export type ActivityVisualKind =
  "create" | "update" | "delete" | "status" | "other";

const KIND_ACTIONS: Readonly<
  Record<Exclude<ActivityVisualKind, "other">, readonly string[]>
> = {
  create: [
    "PROJECT_CREATED",
    "module.create",
    "feature.create",
    "task.create",
    "record.publish",
    "record.version.create",
    "record.draft.create",
    "record.leftover.add",
    "leftover.convert",
    "EXTERNAL_LINK_ADDED",
    "PROJECT_MEMBER_ADDED",
    "PROJECT_JOINED",
  ],
  update: [
    "PROJECT_UPDATED",
    "module.update",
    "feature.update",
    "task.update",
    "record.draft.update",
    "TASK_ASSIGNED",
    "PROJECT_MEMBER_ROLE_CHANGED",
  ],
  delete: [
    "PROJECT_DELETED",
    "MODULE_DELETED",
    "FEATURE_DELETED",
    "TASK_DELETED",
    "EXTERNAL_LINK_REMOVED",
    "PROJECT_MEMBER_REMOVED",
  ],
  status: [
    "PROJECT_STATUS_CHANGED",
    "PROJECT_ARCHIVED",
    "PROJECT_RESTORED",
    "PROJECT_ARCHIVE_REQUESTED",
    "PROJECT_ARCHIVE_REJECTED",
    "module.archive",
    "module.restore",
    "feature.archive",
    "feature.restore",
    "task.complete",
    "task.reopen",
    "task.cancel",
    "task.restore",
    "task.archive",
    "task.unarchive",
    "task.merge",
    "task.unmerge",
    "TASK_ARCHIVED",
    "TASK_RESTORED",
    "TASK_COMPLETED",
    "CHANGE_RECORD_VOIDED",
    "CHANGE_RECORD_RESTORED",
  ],
};

const KIND_BY_ACTION: ReadonlyMap<string, ActivityVisualKind> = new Map(
  Object.entries(KIND_ACTIONS).flatMap(([kind, actions]) =>
    actions.map((action): [string, ActivityVisualKind] => [
      action,
      kind as ActivityVisualKind,
    ]),
  ),
);

/** 活动类型 -> 视觉类别；未收录的取值统一退回 other。 */
export function activityVisualKind(activityType: string): ActivityVisualKind {
  return KIND_BY_ACTION.get(activityType) ?? "other";
}

const ENTITY_ICONS: Readonly<Record<string, InpulseIconName>> = {
  PROJECT: "folder",
  MODULE: "layers",
  FEATURE: "kanban",
  TASK: "boxes",
  TASK_GROUP: "list",
  CHANGE_RECORD: "fileText",
  EXTERNAL_LINK: "externalLink",
  LEFTOVER_ITEM: "alert",
};

/** sourceEntityType -> 对象图标；未收录的取值退回通用 activity 图标。 */
export function activityEntityIcon(sourceEntityType: string): InpulseIconName {
  return ENTITY_ICONS[sourceEntityType] ?? "activity";
}
