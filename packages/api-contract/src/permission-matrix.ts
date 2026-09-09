/**
 * ADR-019：Route Registry 与可执行权限矩阵一一对应。
 * 身份集合必须与 docs/permissions.md 的“身份定义”表精确相等，
 * 由 checkPermissionMatrix 在 CI 中跨文档与代码校验。
 */
export const permissionIdentities = [
  "匿名",
  "活跃成员",
  "其他项目成员",
  "已移除成员",
  "停用用户",
  "系统管理员",
] as const;

export type PermissionIdentity = (typeof permissionIdentities)[number];

export type DenyStatus = 401 | 403 | 404 | 409;

/**
 * allow：该身份可执行；deny：该身份被拒绝并返回固定状态码；
 * conditional：存在明确前置条件，条件不满足时必须返回 deniedWith。
 * 测试矩阵 AUTHZ-001 要求每条路由至少一条允许与一条拒绝用例。
 */
export type MatrixOutcome =
  | { readonly kind: "allow" }
  | { readonly kind: "deny"; readonly status: DenyStatus }
  | {
      readonly kind: "conditional";
      readonly allowedWhen: string;
      readonly deniedWith: DenyStatus;
    };

export interface PermissionMatrixEntry {
  readonly operationId: string;
  readonly outcomes: Readonly<Record<PermissionIdentity, MatrixOutcome>>;
}

/**
 * 只登记已在 Route Registry 中注册的操作。authPolicy 为 none 的运维探针
 * 对全部身份开放，其“拒绝用例”由 checkPermissionMatrix 按 authPolicy 豁免，
 * 不得据此放宽任何业务或认证路由。
 */
export const permissionMatrix = [
  {
    operationId: "getHealth",
    outcomes: {
      匿名: { kind: "allow" },
      活跃成员: { kind: "allow" },
      其他项目成员: { kind: "allow" },
      已移除成员: { kind: "allow" },
      停用用户: { kind: "allow" },
      系统管理员: { kind: "allow" },
    },
  },
  {
    operationId: "getHealthLive",
    outcomes: {
      匿名: { kind: "allow" },
      活跃成员: { kind: "allow" },
      其他项目成员: { kind: "allow" },
      已移除成员: { kind: "allow" },
      停用用户: { kind: "allow" },
      系统管理员: { kind: "allow" },
    },
  },
  {
    operationId: "getHealthReady",
    outcomes: {
      匿名: { kind: "allow" },
      活跃成员: { kind: "allow" },
      其他项目成员: { kind: "allow" },
      已移除成员: { kind: "allow" },
      停用用户: { kind: "allow" },
      系统管理员: { kind: "allow" },
    },
  },
  {
    operationId: "issueCsrfToken",
    outcomes: {
      匿名: { kind: "allow" },
      活跃成员: { kind: "allow" },
      其他项目成员: { kind: "allow" },
      已移除成员: { kind: "allow" },
      停用用户: { kind: "allow" },
      系统管理员: { kind: "allow" },
    },
  },
  {
    operationId: "login",
    outcomes: {
      匿名: { kind: "allow" },
      活跃成员: { kind: "allow" },
      其他项目成员: { kind: "allow" },
      已移除成员: { kind: "allow" },
      停用用户: { kind: "allow" },
      系统管理员: { kind: "allow" },
    },
  },
  {
    operationId: "logout",
    outcomes: {
      匿名: { kind: "allow" },
      活跃成员: { kind: "allow" },
      其他项目成员: { kind: "allow" },
      已移除成员: { kind: "allow" },
      停用用户: { kind: "allow" },
      系统管理员: { kind: "allow" },
    },
  },
  {
    operationId: "getCurrentUser",
    outcomes: {
      匿名: { kind: "deny", status: 401 },
      活跃成员: { kind: "allow" },
      其他项目成员: { kind: "allow" },
      已移除成员: { kind: "allow" },
      停用用户: { kind: "deny", status: 401 },
      系统管理员: { kind: "allow" },
    },
  },
  {
    operationId: "getSearch",
    outcomes: {
      匿名: { kind: "deny", status: 401 },
      活跃成员: { kind: "allow" },
      其他项目成员: { kind: "allow" },
      已移除成员: { kind: "allow" },
      停用用户: { kind: "deny", status: 401 },
      系统管理员: { kind: "allow" },
    },
  },
  {
    operationId: "getProjectActivity",
    outcomes: {
      匿名: { kind: "deny", status: 401 },
      活跃成员: { kind: "allow" },
      其他项目成员: { kind: "deny", status: 404 },
      已移除成员: { kind: "deny", status: 404 },
      停用用户: { kind: "deny", status: 401 },
      系统管理员: { kind: "allow" },
    },
  },
  {
    operationId: "getNotifications",
    outcomes: {
      匿名: { kind: "deny", status: 401 },
      活跃成员: { kind: "allow" },
      其他项目成员: { kind: "allow" },
      已移除成员: { kind: "allow" },
      停用用户: { kind: "deny", status: 401 },
      系统管理员: { kind: "allow" },
    },
  },
  {
    operationId: "getNotificationUnreadCount",
    outcomes: {
      匿名: { kind: "deny", status: 401 },
      活跃成员: { kind: "allow" },
      其他项目成员: { kind: "allow" },
      已移除成员: { kind: "allow" },
      停用用户: { kind: "deny", status: 401 },
      系统管理员: { kind: "allow" },
    },
  },
  {
    operationId: "readNotification",
    outcomes: {
      匿名: { kind: "deny", status: 401 },
      活跃成员: { kind: "allow" },
      其他项目成员: { kind: "allow" },
      已移除成员: { kind: "allow" },
      停用用户: { kind: "deny", status: 401 },
      系统管理员: { kind: "allow" },
    },
  },
  {
    operationId: "unreadNotification",
    outcomes: {
      匿名: { kind: "deny", status: 401 },
      活跃成员: { kind: "allow" },
      其他项目成员: { kind: "allow" },
      已移除成员: { kind: "allow" },
      停用用户: { kind: "deny", status: 401 },
      系统管理员: { kind: "allow" },
    },
  },
  {
    operationId: "readAllNotifications",
    outcomes: {
      匿名: { kind: "deny", status: 401 },
      活跃成员: { kind: "allow" },
      其他项目成员: { kind: "allow" },
      已移除成员: { kind: "allow" },
      停用用户: { kind: "deny", status: 401 },
      系统管理员: { kind: "allow" },
    },
  },
  {
    operationId: "createProject",
    outcomes: {
      匿名: { kind: "deny", status: 401 },
      活跃成员: { kind: "allow" },
      其他项目成员: { kind: "allow" },
      已移除成员: { kind: "allow" },
      停用用户: { kind: "deny", status: 401 },
      系统管理员: { kind: "allow" },
    },
  },
] satisfies readonly PermissionMatrixEntry[];

export function outcomeAllows(outcome: MatrixOutcome): boolean {
  return outcome.kind === "allow" || outcome.kind === "conditional";
}

export function outcomeDenies(outcome: MatrixOutcome): boolean {
  return outcome.kind === "deny" || outcome.kind === "conditional";
}
