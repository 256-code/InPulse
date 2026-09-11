/**
 * 成员与设置页的只读界面镜像，来源为设计师稿 latest-version/views/settings.tsx。
 *
 * 授权的可执行真相源仍是 docs/permissions.md 与 packages/api-contract 的路由权限矩阵；
 * 本文件只承载说明表文案，不含任何鉴权判断，也不得被其他模块引用。
 * docs/permissions.md 的功能级条目发生变化时必须同步本文件。
 */

export interface PermissionMatrixRow {
  readonly feature: string;
  readonly admin: boolean;
  readonly member: boolean;
  readonly note: string;
}

export const permissionMatrixRows: readonly PermissionMatrixRow[] = [
  {
    feature: "查看所有项目",
    admin: true,
    member: false,
    note: "项目成员只能看已加入项目",
  },
  { feature: "查看已加入项目", admin: true, member: true, note: "—" },
  {
    feature: "创建项目",
    admin: true,
    member: true,
    note: "创建者自动成为初始成员且不可取消",
  },
  {
    feature: "创建项目时选择初始成员",
    admin: true,
    member: true,
    note: "创建表单中创建者默认勾选且不可取消",
  },
  {
    feature: "编辑项目名称和描述",
    admin: true,
    member: true,
    note: "项目成员需已加入项目",
  },
  {
    feature: "修改项目编码",
    admin: false,
    member: false,
    note: "编码创建后不可修改",
  },
  {
    feature: "添加/移除项目成员",
    admin: true,
    member: false,
    note: "高风险权限",
  },
  { feature: "归档/恢复项目", admin: true, member: false, note: "高风险权限" },
  { feature: "创建模块", admin: true, member: true, note: "—" },
  { feature: "编辑模块", admin: true, member: true, note: "—" },
  { feature: "归档/恢复模块", admin: true, member: false, note: "高风险权限" },
  { feature: "创建功能", admin: true, member: true, note: "—" },
  { feature: "编辑功能", admin: true, member: true, note: "—" },
  {
    feature: "编辑当前功能说明",
    admin: true,
    member: true,
    note: "保存操作日志",
  },
  { feature: "归档/恢复功能", admin: true, member: false, note: "高风险权限" },
  { feature: "创建任务", admin: true, member: true, note: "—" },
  { feature: "编辑任务", admin: true, member: true, note: "普通项目成员均可" },
  {
    feature: "指派/改派任务",
    admin: true,
    member: true,
    note: "必须指派给项目成员",
  },
  {
    feature: "完成/重新打开任务",
    admin: true,
    member: true,
    note: "记录操作人",
  },
  {
    feature: "取消/恢复任务",
    admin: true,
    member: true,
    note: "取消原因建议填写",
  },
  { feature: "合并任务", admin: true, member: true, note: "有迭代记录也允许" },
  { feature: "解除合并", admin: true, member: true, note: "必须二次确认" },
  { feature: "创建迭代记录", admin: true, member: true, note: "—" },
  { feature: "编辑迭代草稿", admin: true, member: true, note: "—" },
  { feature: "发布迭代记录", admin: true, member: true, note: "必填字段校验" },
  {
    feature: "编辑已发布记录",
    admin: true,
    member: true,
    note: "必须生成新版本",
  },
  {
    feature: "作废/恢复迭代记录",
    admin: true,
    member: false,
    note: "高风险权限",
  },
  {
    feature: "添加/删除 GitHub 链接",
    admin: true,
    member: true,
    note: "操作留痕",
  },
  {
    feature: "配置 GitHub 应用或 Token",
    admin: false,
    member: false,
    note: "V1.1 不接入 GitHub API，也不持有 Token",
  },
  { feature: "查看项目动态", admin: true, member: true, note: "—" },
  {
    feature: "查看原始审计快照",
    admin: true,
    member: false,
    note: "项目成员看可读动态",
  },
  { feature: "用户账号管理", admin: true, member: false, note: "—" },
  { feature: "系统配置", admin: true, member: false, note: "—" },
];

export interface NotificationScenarioRow {
  readonly event: string;
  readonly audience: string;
}

export const notificationScenarios: readonly NotificationScenarioRow[] = [
  { event: "项目成员被加入", audience: "被加入用户" },
  { event: "任务被指派", audience: "新负责人" },
  { event: "任务负责人被修改", audience: "新负责人，旧负责人可选" },
  { event: "任务完成", audience: "任务创建人、相关记录作者" },
  { event: "任务重新打开", audience: "任务负责人、创建人" },
  {
    event: "任务被合并",
    audience: "主任务负责人、来源任务负责人、双方创建人",
  },
  { event: "任务解除合并", audience: "相关任务负责人和创建人" },
  { event: "迭代记录发布", audience: "相关任务负责人、功能相关人员" },
  { event: "迭代记录被修改", audience: "原记录作者、任务负责人" },
  { event: "遗留问题转为任务", audience: "新任务负责人" },
];
