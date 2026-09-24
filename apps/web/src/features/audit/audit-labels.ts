/**
 * F-08 原始审计的展示标签：`action` 与 `targetType` 是审计契约里的机器码，
 * 列表与筛选一律显示中文；未收录的取值按原样显示，便于在界面上发现新的
 * 后端事件。映射只服务展示，请求仍发送原始码（服务端按码精确匹配）。
 */
const ACTION_LABELS: Readonly<Record<string, string>> = {
  "project.create": "创建项目",
  "project.update": "更新项目",
  "project.status.change": "变更项目状态",
  "project.archive": "归档项目",
  "project.restore": "恢复项目",
  "project.archive.request": "提交归档申请",
  "project.archive.reject": "驳回归档申请",
  "project.member.add": "添加项目成员",
  "project.member.remove": "移除项目成员",
  "project.member.role.set": "调整成员角色",
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
  "task.status": "变更任务状态",
  "task.archive": "归档任务",
  "task.unarchive": "恢复任务",
  "task.merge": "合并任务",
  "task.unmerge": "解除合并",
  "record.draft.create": "创建草稿",
  "record.draft.update": "更新草稿",
  "record.publish": "发布记录",
  "record.version.create": "修订记录",
  "record.leftover.add": "追加遗留问题",
  "leftover.convert": "遗留问题转任务",
  CHANGE_RECORD_VOIDED: "作废记录",
  CHANGE_RECORD_RESTORED: "恢复记录",
  EXTERNAL_LINK_ADDED: "添加 GitHub 关联",
  EXTERNAL_LINK_REMOVED: "解除 GitHub 关联",
  "admin.user.create": "创建用户",
  "admin.user.update": "更新用户",
  "admin.user.disable": "停用用户",
  "admin.user.enable": "启用用户",
  "admin.user.force_logout": "强制退出登录",
  "auth.sso_login": "统一身份认证登录",
  "auth.sso_login_failed": "统一身份认证登录失败",
  "auth.sso_account_provisioned": "统一身份认证首次开通账号",
  "auth.sso_account_linked": "绑定统一身份认证账号",
  AUDIT_LOG_READ: "读取审计日志",
  AUDIT_KEY_ROTATED: "轮换审计签名密钥",
  SYSTEM_TEST: "系统测试写入",
};

/** 演示种子数据等整族前缀：整族共用同一文案，避免逐条枚举。 */
const ACTION_PREFIX_LABELS: ReadonlyArray<readonly [string, string]> = [
  ["AUDIT_SEED_", "演示种子数据"],
];

export function auditActionLabel(action: string): string {
  const exact = ACTION_LABELS[action];
  if (exact !== undefined) {
    return exact;
  }
  for (const [prefix, label] of ACTION_PREFIX_LABELS) {
    if (action.startsWith(prefix)) {
      return label;
    }
  }
  return action;
}

/** 「中文（原始码）」对照文案；未收录动作只显示原始码，避免出现 `X（X）`。 */
export function auditActionWithCode(action: string): string {
  const label = auditActionLabel(action);
  return label === action ? action : label + "（" + action + "）";
}

const TARGET_TYPE_LABELS: Readonly<Record<string, string>> = {
  USER: "用户",
  SYSTEM: "系统",
  AUDIT_CHAIN: "审计链",
  PROJECT: "项目",
  MODULE: "模块",
  FEATURE: "功能",
  TASK: "任务",
  TASK_GROUP: "任务聚合组",
  CHANGE_RECORD: "迭代记录",
  LEFTOVER_ITEM: "遗留问题",
  EXTERNAL_LINK: "GitHub 链接",
};

export function auditTargetTypeLabel(targetType: string): string {
  return TARGET_TYPE_LABELS[targetType] ?? targetType;
}

export function auditTargetTypeWithCode(targetType: string): string {
  const label = auditTargetTypeLabel(targetType);
  return label === targetType ? targetType : label + "（" + targetType + "）";
}

export interface AuditActionOption {
  readonly code: string;
  readonly label: string;
}

/** 动作筛选候选：按中文名排序，填入的仍是服务端要求的原始码。 */
export const AUDIT_ACTION_OPTIONS: readonly AuditActionOption[] =
  Object.entries(ACTION_LABELS)
    .map(([code, label]) => ({ code, label }))
    .sort((left, right) => left.label.localeCompare(right.label, "zh-Hans-CN"));
