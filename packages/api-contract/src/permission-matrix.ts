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
    operationId: "listTaskCenter",
    outcomes: {
      匿名: { kind: "deny", status: 401 },
      活跃成员: {
        kind: "conditional",
        allowedWhen:
          "mine/created/project 且 SQL 仅返回当前授权项目；all 仅管理员",
        deniedWith: 403,
      },
      其他项目成员: {
        kind: "conditional",
        allowedWhen: "仅返回其余可访问项目，all 仅管理员",
        deniedWith: 403,
      },
      已移除成员: {
        kind: "conditional",
        allowedWhen: "已移除项目不返回，all 仅管理员",
        deniedWith: 403,
      },
      停用用户: { kind: "deny", status: 401 },
      系统管理员: { kind: "allow" },
    },
  },

  ...["listExternalLinks", "addExternalLink", "removeExternalLink"].map(
    (operationId): PermissionMatrixEntry => ({
      operationId,
      outcomes: {
        匿名: { kind: "deny", status: 401 },
        活跃成员: {
          kind: "conditional",
          allowedWhen: "目标当前可读；写入另需目标和父级可写及当前版本",
          deniedWith: 404,
        },
        其他项目成员: { kind: "deny", status: 404 },
        已移除成员: { kind: "deny", status: 404 },
        停用用户: { kind: "deny", status: 401 },
        系统管理员: {
          kind: "conditional",
          allowedWhen: "目标存在；VOID只读，写入需目标和父级可写",
          deniedWith: 404,
        },
      },
    }),
  ),

  ...(["voidChangeRecord", "restoreChangeRecord"] as const).map(
    (operationId): PermissionMatrixEntry => ({
      operationId,
      outcomes: {
        匿名: { kind: "deny", status: 401 },
        活跃成员: { kind: "deny", status: 403 },
        其他项目成员: { kind: "deny", status: 403 },
        已移除成员: { kind: "deny", status: 403 },
        停用用户: { kind: "deny", status: 401 },
        系统管理员: {
          kind: "conditional",
          allowedWhen: "完整管理员 Session",
          deniedWith: 403,
        },
      },
    }),
  ),
  ...(["listModules", "createModule", "updateModule"] as const).map(
    (operationId): PermissionMatrixEntry => ({
      operationId,
      outcomes: {
        匿名: { kind: "deny", status: 401 },
        活跃成员: { kind: "allow" },
        其他项目成员: { kind: "deny", status: 404 },
        已移除成员: { kind: "deny", status: 404 },
        停用用户: { kind: "deny", status: 401 },
        系统管理员: { kind: "allow" },
      },
    }),
  ),
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
      "convertLeftoverToTask",
      "previewLeftoverTask",
      "getLeftoverTaskSource",
      "createChangeRecordVersion",
      "addChangeRecordLeftover",
      "getTaskRecordDrafts",
      "createTaskRecordDraft",
      "updateTaskRecordDraft",
      "getRecordDraft",
      "createIndependentRecordDraft",
      "updateIndependentRecordDraft",
      "listTasks",
      "getTask",
      "listTaskAssignees",
      "listActiveProjectMembers",
      "createTaskWithScope",
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
      "unmergeTaskGroup",
      "transitionTask",
      "transitionModuleTask",
      "getFeature",
      "findSimilarFeatures",
      "createFeature",
      "updateFeature",
    ] as const
  ).map((operationId): PermissionMatrixEntry => ({
    operationId,
    outcomes: {
      匿名: { kind: "deny", status: 401 },
      活跃成员: { kind: "allow" },
      其他项目成员: { kind: "deny", status: 404 },
      已移除成员: { kind: "deny", status: 404 },
      停用用户: { kind: "deny", status: 401 },
      系统管理员: { kind: "allow" },
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
    operationId: "startSsoLogin",
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
    operationId: "completeSsoLogin",
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
          "完整系统管理员 Session；移除或停用管理员时仍须保留至少一名可用管理员，且禁止自移除/自停用/自强退",
        deniedWith: 403,
      },
    },
  })),
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
    operationId: "getAuditLogs",
    outcomes: {
      匿名: { kind: "deny", status: 401 },
      活跃成员: { kind: "deny", status: 403 },
      其他项目成员: { kind: "deny", status: 403 },
      已移除成员: { kind: "deny", status: 403 },
      停用用户: { kind: "deny", status: 401 },
      系统管理员: { kind: "allow" },
    },
  },
  {
    operationId: "getTaskGroup",
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
    operationId: "listTaskGroupRecords",
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
    operationId: "getProjectOverview",
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
    operationId: "getProjectTaskBoard",
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
    operationId: "listMyTasks",
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
    operationId: "listLeftoverItems",
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
    operationId: "listTaskGroups",
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
    operationId: "listTaskGroupMemberships",
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
    operationId: "listRecordFeed",
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
    operationId: "listMyRecordDrafts",
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
    operationId: "changeProjectStatus",
    outcomes: {
      匿名: { kind: "deny", status: 401 },
      活跃成员: {
        kind: "conditional",
        allowedWhen:
          "ADR-039：本项目任意活跃成员（实时成员关系），CSRF、Idempotency-Key 与 If-Match 必填；进入维护中要求项目下任务全部收尾，仍有未完成且未归档的任务时 409 PROJECT_MAINTENANCE_TASKS_OPEN；未开始与维护中互改 409 PROJECT_STATUS_LEVEL_SKIP，已有完成任务回退未开始 409 PROJECT_STATUS_NOT_STARTED_LOCKED",
        deniedWith: 403,
      },
      其他项目成员: { kind: "deny", status: 404 },
      已移除成员: { kind: "deny", status: 404 },
      停用用户: { kind: "deny", status: 401 },
      系统管理员: {
        kind: "conditional",
        allowedWhen:
          "完整系统管理员 Session；CSRF、Idempotency-Key 与 If-Match 必填，维护中任务收尾门禁与两条硬约束同样返回 409",
        deniedWith: 403,
      },
    },
  },
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
      活跃成员: {
        kind: "conditional",
        allowedWhen:
          "ADR-039：本项目任意活跃成员（实时成员关系）" +
          (operationId === "removeProjectMember"
            ? "；目标为本项目 LEADER 时 409，须先由系统管理员转移/撤销"
            : ""),
        deniedWith: 403,
      },
      其他项目成员: { kind: "deny", status: 404 },
      已移除成员: { kind: "deny", status: 404 },
      停用用户: { kind: "deny", status: 401 },
      系统管理员: {
        kind: "conditional",
        allowedWhen:
          "完整系统管理员 Session；移除前未完成任务可按需改派，不改派保留历史负责人但成员失去项目访问权与角色；目标为本项目 LEADER 时 409",
        deniedWith: 403,
      },
    },
  })),
  {
    operationId: "setProjectMemberRole",
    outcomes: {
      匿名: { kind: "deny", status: 401 },
      活跃成员: {
        kind: "conditional",
        allowedWhen:
          "ADR-039：仅系统管理员可任命/撤销组长；本项目组长与普通成员一律 403 PROJECT_MEMBER_ROLE_FORBIDDEN，非成员 404",
        deniedWith: 403,
      },
      其他项目成员: { kind: "deny", status: 404 },
      已移除成员: { kind: "deny", status: 404 },
      停用用户: { kind: "deny", status: 401 },
      系统管理员: {
        kind: "conditional",
        allowedWhen:
          "完整系统管理员 Session；可设 MEMBER/LEADER（含转移组长），目标必须 ACTIVE 成员，LEADER 唯一性冲突 409 PROJECT_MEMBER_LEADER_CONFLICT",
        deniedWith: 403,
      },
    },
  },
  ...(
    [
      "archiveTask",
      "restoreTask",
      "archiveModuleTask",
      "restoreModuleTask",
    ] as const
  ).map((operationId): PermissionMatrixEntry => ({
    operationId,
    outcomes: {
      匿名: { kind: "deny", status: 401 },
      活跃成员: {
        kind: "conditional",
        allowedWhen:
          "ADR-033/ADR-039：本项目任意活跃成员（实时成员关系），父级 ACTIVE、原因/If-Match/CSRF 与幂等必填",
        deniedWith: 403,
      },
      其他项目成员: { kind: "deny", status: 404 },
      已移除成员: { kind: "deny", status: 404 },
      停用用户: { kind: "deny", status: 401 },
      系统管理员: {
        kind: "conditional",
        allowedWhen: "完整管理员 Session；原因、If-Match、CSRF 与幂等必填",
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
