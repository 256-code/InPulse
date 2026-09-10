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
  ...(
    [
      "listModules",
      "createModule",
      "updateModule",
      "archiveModule",
      "restoreModule",
    ] as const
  ).map((operationId): PermissionMatrixEntry => ({
    operationId,
    outcomes: {
      匿名: { kind: "deny", status: 401 },
      活跃成员:
        operationId === "archiveModule" || operationId === "restoreModule"
          ? { kind: "deny", status: 403 }
          : { kind: "allow" },
      其他项目成员: { kind: "deny", status: 404 },
      已移除成员: { kind: "deny", status: 404 },
      停用用户: { kind: "deny", status: 401 },
      系统管理员:
        operationId === "archiveModule" || operationId === "restoreModule"
          ? {
              kind: "conditional",
              allowedWhen: "完整管理员 Session 且密码/TOTP 重认证均在五分钟内",
              deniedWith: 403,
            }
          : { kind: "allow" },
    },
  })),
  ...(
    [
      "listFeatures",
      "listRecordDrafts",
      "listChangeRecords",
      "getChangeRecord",
      "listChangeRecordVersions",
      "getChangeRecordVersion",
      "publishChangeRecord",
      "completeTask",
      "createChangeRecordVersion",
      "getTaskRecordDrafts",
      "createTaskRecordDraft",
      "updateTaskRecordDraft",
      "getRecordDraft",
      "createIndependentRecordDraft",
      "updateIndependentRecordDraft",
      "listTasks",
      "getTask",
      "listTaskAssignees",
      "createTask",
      "updateTask",
      "listModuleTasks",
      "getModuleTask",
      "listModuleTaskAssignees",
      "createModuleTask",
      "updateModuleTask",
      "getTaskStatusHistory",
      "getModuleTaskStatusHistory",
      "mergeTaskGroup",
      "transitionTask",
      "transitionModuleTask",
      "getFeature",
      "findSimilarFeatures",
      "createFeature",
      "updateFeature",
      "archiveFeature",
      "restoreFeature",
    ] as const
  ).map((operationId): PermissionMatrixEntry => ({
    operationId,
    outcomes: {
      匿名: { kind: "deny", status: 401 },
      活跃成员:
        operationId === "archiveFeature" || operationId === "restoreFeature"
          ? { kind: "deny", status: 403 }
          : { kind: "allow" },
      其他项目成员: { kind: "deny", status: 404 },
      已移除成员: { kind: "deny", status: 404 },
      停用用户: { kind: "deny", status: 401 },
      系统管理员:
        operationId === "archiveFeature" || operationId === "restoreFeature"
          ? {
              kind: "conditional",
              allowedWhen: "完整管理员 Session 且密码/TOTP 重认证均在五分钟内",
              deniedWith: 403,
            }
          : { kind: "allow" },
    },
  })),
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
    operationId: "startMfaEnrollment",
    outcomes: {
      匿名: { kind: "deny", status: 401 },
      活跃成员: { kind: "deny", status: 403 },
      其他项目成员: { kind: "deny", status: 403 },
      已移除成员: { kind: "deny", status: 403 },
      停用用户: { kind: "deny", status: 401 },
      系统管理员: {
        kind: "conditional",
        allowedWhen:
          "系统管理员且当前 Session 为 MFA_ENROLLMENT 且 generation 匹配",
        deniedWith: 409,
      },
    },
  },
  {
    operationId: "confirmMfaEnrollment",
    outcomes: {
      匿名: { kind: "deny", status: 401 },
      活跃成员: { kind: "deny", status: 403 },
      其他项目成员: { kind: "deny", status: 403 },
      已移除成员: { kind: "deny", status: 403 },
      停用用户: { kind: "deny", status: 401 },
      系统管理员: {
        kind: "conditional",
        allowedWhen:
          "系统管理员且当前 Session 为 MFA_ENROLLMENT 且存在匹配 pending 与未使用 TOTP time-step",
        deniedWith: 409,
      },
    },
  },
  {
    operationId: "verifyMfa",
    outcomes: {
      匿名: { kind: "deny", status: 401 },
      活跃成员: { kind: "deny", status: 403 },
      其他项目成员: { kind: "deny", status: 403 },
      已移除成员: { kind: "deny", status: 403 },
      停用用户: { kind: "deny", status: 401 },
      系统管理员: {
        kind: "conditional",
        allowedWhen:
          "系统管理员且当前 Session 为 MFA_CHALLENGE 且存在未使用的 TOTP time-step",
        deniedWith: 409,
      },
    },
  },
  {
    operationId: "reauthenticateAdmin",
    outcomes: {
      匿名: { kind: "deny", status: 401 },
      活跃成员: { kind: "deny", status: 403 },
      其他项目成员: { kind: "deny", status: 403 },
      已移除成员: { kind: "deny", status: 403 },
      停用用户: { kind: "deny", status: 401 },
      系统管理员: {
        kind: "conditional",
        allowedWhen:
          "系统管理员且当前 Session 为 AUTHENTICATED，密码与 ACTIVE 因子未使用当前 TOTP time-step 均通过",
        deniedWith: 409,
      },
    },
  },
  {
    operationId: "rotateMfaRecoveryCodes",
    outcomes: {
      匿名: { kind: "deny", status: 401 },
      活跃成员: { kind: "deny", status: 403 },
      其他项目成员: { kind: "deny", status: 403 },
      已移除成员: { kind: "deny", status: 403 },
      停用用户: { kind: "deny", status: 401 },
      系统管理员: {
        kind: "conditional",
        allowedWhen:
          "系统管理员且当前 Session 为 AUTHENTICATED，最近5分钟内完成双因子重认证且该次 rotation generation 未消费",
        deniedWith: 409,
      },
    },
  },
  {
    operationId: "consumeMfaRecoveryCode",
    outcomes: {
      匿名: { kind: "deny", status: 401 },
      活跃成员: { kind: "deny", status: 403 },
      其他项目成员: { kind: "deny", status: 403 },
      已移除成员: { kind: "deny", status: 403 },
      停用用户: { kind: "deny", status: 401 },
      系统管理员: {
        kind: "conditional",
        allowedWhen:
          "系统管理员且当前 Session 为 RECOVERY_CHALLENGE 且存在未使用的恢复码",
        deniedWith: 409,
      },
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
    operationId: "getUserDirectory",
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
    operationId: "listAdminUsers",
    outcomes: {
      匿名: { kind: "deny", status: 401 },
      活跃成员: { kind: "deny", status: 403 },
      其他项目成员: { kind: "deny", status: 403 },
      已移除成员: { kind: "deny", status: 403 },
      停用用户: { kind: "deny", status: 401 },
      系统管理员: { kind: "allow" },
    },
  },
  ...(
    [
      "createUser",
      "updateUser",
      "disableUser",
      "enableUser",
      "forceLogoutUser",
    ] as const
  ).map((operationId): PermissionMatrixEntry => ({
    operationId,
    outcomes: {
      匿名: { kind: "deny", status: 401 },
      活跃成员: { kind: "deny", status: 403 },
      其他项目成员: { kind: "deny", status: 403 },
      已移除成员: { kind: "deny", status: 403 },
      停用用户: { kind: "deny", status: 401 },
      系统管理员: {
        kind: "conditional",
        allowedWhen:
          "完整系统管理员 Session 且密码/当前 TOTP 双因子重认证均在五分钟内；移除管理员时仍须保留至少一名可用 MFA 管理员，且禁止自移除/自停用/自强退",
        deniedWith: 403,
      },
    },
  })),
  {
    operationId: "resetAdminMfa",
    outcomes: {
      匿名: { kind: "deny", status: 401 },
      活跃成员: { kind: "deny", status: 403 },
      其他项目成员: { kind: "deny", status: 403 },
      已移除成员: { kind: "deny", status: 403 },
      停用用户: { kind: "deny", status: 401 },
      系统管理员: {
        kind: "conditional",
        allowedWhen:
          "系统管理员且当前 Session 最近5分钟内完成双因子重认证，目标是另一名已启用 TOTP 的 ACTIVE 系统管理员，且可用 MFA 管理员数大于1",
        deniedWith: 409,
      },
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
  {
    operationId: "listProjects",
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
    operationId: "getProject",
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
    operationId: "updateProject",
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
    operationId: "getProjectArchivePreview",
    outcomes: {
      匿名: { kind: "deny", status: 401 },
      活跃成员: { kind: "deny", status: 403 },
      其他项目成员: { kind: "deny", status: 404 },
      已移除成员: { kind: "deny", status: 404 },
      停用用户: { kind: "deny", status: 401 },
      系统管理员: {
        kind: "conditional",
        allowedWhen:
          "完整系统管理员 Session 且密码与当前 TOTP 重认证均在 5 分钟内；只读，不要求 CSRF 或幂等键",
        deniedWith: 403,
      },
    },
  },
  ...(["archiveProject", "restoreProject"] as const).map(
    (operationId): PermissionMatrixEntry => ({
      operationId,
      outcomes: {
        匿名: { kind: "deny", status: 401 },
        活跃成员: { kind: "deny", status: 403 },
        其他项目成员: { kind: "deny", status: 404 },
        已移除成员: { kind: "deny", status: 404 },
        停用用户: { kind: "deny", status: 401 },
        系统管理员: {
          kind: "conditional",
          allowedWhen:
            operationId === "archiveProject"
              ? "完整系统管理员 Session + 5 分钟双因子重认证；项目 ACTIVE，原因、If-Match、CSRF 与幂等必填"
              : "完整系统管理员 Session + 5 分钟双因子重认证；项目 ARCHIVED，原因、If-Match、CSRF 与幂等必填",
          deniedWith: 403,
        },
      },
    }),
  ),
  ...(
    [
      "listProjectMembers",
      "listProjectMemberUnfinishedTasks",
      "addProjectMember",
      "removeProjectMember",
    ] as const
  ).map((operationId): PermissionMatrixEntry => ({
    operationId,
    outcomes: {
      匿名: { kind: "deny", status: 401 },
      活跃成员: { kind: "deny", status: 403 },
      其他项目成员: { kind: "deny", status: 404 },
      已移除成员: { kind: "deny", status: 404 },
      停用用户: { kind: "deny", status: 401 },
      系统管理员: {
        kind: "conditional",
        allowedWhen:
          "完整系统管理员 Session 且密码与当前 TOTP 重认证均在 5 分钟内；移除前未完成任务可按需改派，不改派保留历史负责人但成员失去项目访问权",
        deniedWith: 403,
      },
    },
  })),
] satisfies readonly PermissionMatrixEntry[];

export function outcomeAllows(outcome: MatrixOutcome): boolean {
  return outcome.kind === "allow" || outcome.kind === "conditional";
}

export function outcomeDenies(outcome: MatrixOutcome): boolean {
  return outcome.kind === "deny" || outcome.kind === "conditional";
}
