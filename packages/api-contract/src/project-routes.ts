import type { BodyBinding, RouteDefinition } from "./route-definition.js";
import type { SchemaName } from "./schema-registry.js";

const json = (schemaRef: SchemaName): BodyBinding => ({
  body: { contentTypes: [{ contentType: "application/json", schemaRef }] },
});

const errors = {
  "400": json("ErrorResponse"),
  "401": json("ErrorResponse"),
  "403": json("ErrorResponse"),
  "404": json("ErrorResponse"),
  "409": json("ErrorResponse"),
  "422": json("ErrorResponse"),
  "500": json("ErrorResponse"),
};

/** ProjectDetailResponse 的完整叶子字段；幂等重放必须逐字段声明。 */
const projectDetailFields = [
  "project.id",
  "project.code",
  "project.name",
  "project.description",
  "project.status",
  "project.hasCompletedTask",
  "project.rowVersion",
  "project.createdBy",
  "project.createdAt",
  "project.updatedAt",
  "project.memberCount",
  "project.stats.activeModuleCount",
  "project.stats.activeFeatureCount",
  "project.stats.openTaskCount",
  "project.stats.completedTaskCount",
  "currentUserRole",
] as const;

const replayPolicy = {
  version: "1.0.0",
  success: {
    "200": {
      body: {
        responseSchemaRef: "ProjectDetailResponse" as const,
        safeBodyFieldPaths: projectDetailFields,
      },
    },
  },
} as const;

const replayAuthorization = {
  version: "1.0.0",
  resources: {
    contextSchemaRef: "ProjectReplayContext" as const,
    resultRefExtractor: "projectId",
    currentReadAuthorizer: "projectCurrentReadAuthorizer",
  },
} as const;

/**
 * ADR-049：删除是软删除——项目退出全部可见范围，业务历史、成员关系与审计链保留。
 * 响应无正文，因此重放策略只有 noBody 分支；载荷本身不携带任何项目字段。
 */
const deleteReplayPolicy = {
  version: "1.0.0",
  success: { "204": { noBody: true } },
} as const;

/**
 * 删除的幂等重放授权：项目在成功删除后已不可读，但「谁有权删」的依据（成员关系）
 * 仍然保留在库内，因此重放复核沿用同一角色门禁的记录的成员关系，
 * 让网络重试得到与首次相同的 204，而不是 404。
 */
const deleteReplayAuthorization = {
  version: "1.0.0",
  resources: {
    contextSchemaRef: "ProjectReplayContext" as const,
    resultRefExtractor: "projectId",
    currentReadAuthorizer: "projectDeleteReplayAuthorizer",
  },
} as const;

/**
 * ADR-051：彻底删除是软删除的第二步，响应携带物理删除的行数统计，
 * 重放逐字段列出可安全持久化的叶子字段。
 */
const purgeReplayPolicy = {
  version: "1.0.0",
  success: {
    "200": {
      body: {
        responseSchemaRef: "ProjectPurgeResponse" as const,
        safeBodyFieldPaths: [
          "purged.projectId",
          "purged.code",
          "purged.name",
          "purged.records.modules",
          "purged.records.features",
          "purged.records.tasks",
          "purged.records.changeRecords",
          "purged.records.auditLogs",
          "purged.records.members",
          "purged.records.total",
        ],
      },
    },
  },
} as const;

/**
 * 彻底删除的重放授权（`projectPurgeReplayAuthorizer`）：项目行连同它的审计链
 * 已被物理删除，结果的当前可读性必然不成立，因此重放只复核「当前 Session 仍是
 * 有效的系统管理员」——与首次执行的门禁同源，只是不再需要项目行。
 */
const purgeReplayAuthorization = {
  version: "1.0.0",
  resources: {
    contextSchemaRef: "ProjectReplayContext" as const,
    resultRefExtractor: "projectId",
    currentReadAuthorizer: "projectPurgeReplayAuthorizer",
  },
} as const;

export const projectRoutes: readonly RouteDefinition[] = [
  {
    method: "PATCH",
    path: "/projects/{projectId}",
    operationId: "updateProject",
    summary:
      "项目活跃成员或系统管理员编辑项目名称与描述；编码不可修改，If-Match 乐观锁防并发覆盖，审计、活动与搜索投影在同一事务提交。2026-09-23 起项目不再有归档态，写权限只受实时成员关系与并发版本约束。",
    request: {
      path: "ProjectPath",
      query: "none",
      headers: "ProjectVersionHeaders",
      body: {
        contentTypes: [
          { contentType: "application/json", schemaRef: "ProjectEditRequest" },
        ],
      },
    },
    responses: { "200": json("ProjectDetailResponse"), ...errors },
    authPolicy: "session",
    csrfPolicy: "required",
    idempotencyPolicy: "idempotencyRequired",
    idempotencyExceptionAdr: "none",
    // ADR-033：详情响应新增 currentUserRole，重放安全字段变化，旧 Key 409。
    // 2026-09-16：项目统计新增 completedTaskCount，重放安全字段变化，旧 Key 409。
    // 2026-09-17：项目四态改造后 ProjectItem 新增 hasCompletedTask，重放安全字段变化，旧 Key 409。
    // 2026-09-22：ADR-039 移除 PROJECT_ADMIN，currentUserRole 枚举收窄，旧 Key 409。
    // 2026-09-23：项目三态改造，project.status 取值域收窄（去掉 ARCHIVED），旧 Key 409。
    idempotencyContractVersion: "1.6.0",
    idempotencyFingerprintVersion: "1.0.0",
    behaviorHeaders: ["If-Match"],
    idempotencyReplayPolicy: replayPolicy,
    replayAuthorizationPolicy: replayAuthorization,
    securityFlowPolicy: "none",
    versionPolicy: {
      apiVersion: "v1",
      schemaVersion: "1.0.0",
      ifMatch: "required",
    },
    concurrencyPolicy: {
      rowVersion: "required",
      lockOrder: ["project"],
      retry: "none; project FOR SHARE then FOR UPDATE, expected row_version",
    },
    auditAction: "project.update",
  },
  {
    method: "PATCH",
    path: "/projects/{projectId}/status",
    operationId: "changeProjectStatus",
    summary:
      "F-06.3 项目状态变更：本项目任意活跃成员或系统管理员（ADR-039）把项目在未开始 / 进行中 / 维护中之间手动切换（2026-09-23 起三态即全部状态，项目不再有归档）；进入维护中要求项目下任务全部收尾，仍有未完成且未归档的任务时 409 PROJECT_MAINTENANCE_TASKS_OPEN；未开始与维护中互改 409 PROJECT_STATUS_LEVEL_SKIP，项目内出现过已完成任务后回退未开始 409 PROJECT_STATUS_NOT_STARTED_LOCKED；维护中不通知，未开始升级为进行中通知全体成员；审计、活动与搜索投影在同一事务提交。",
    request: {
      path: "ProjectPath",
      query: "none",
      headers: "ProjectVersionHeaders",
      body: {
        contentTypes: [
          {
            contentType: "application/json",
            schemaRef: "ProjectStatusChangeRequest",
          },
        ],
      },
    },
    responses: { "200": json("ProjectDetailResponse"), ...errors },
    authPolicy: "session",
    csrfPolicy: "required",
    idempotencyPolicy: "idempotencyRequired",
    idempotencyExceptionAdr: "none",
    // 2026-09-22：ADR-039 门禁改为任意活跃成员且 currentUserRole 枚举收窄，旧 Key 409。
    // 2026-09-23：新增维护中任务收尾门禁与 project.status 取值域收窄，旧 Key 409。
    idempotencyContractVersion: "1.2.0",
    idempotencyFingerprintVersion: "1.0.0",
    behaviorHeaders: ["If-Match"],
    idempotencyReplayPolicy: replayPolicy,
    replayAuthorizationPolicy: replayAuthorization,
    securityFlowPolicy: "none",
    versionPolicy: {
      apiVersion: "v1",
      schemaVersion: "1.0.0",
      ifMatch: "required",
    },
    concurrencyPolicy: {
      rowVersion: "required",
      lockOrder: ["project"],
      retry: "none; project FOR UPDATE, expected row_version",
    },
    auditAction: "project.status.change",
  },
  {
    method: "DELETE",
    path: "/projects/{projectId}",
    operationId: "deleteProject",
    summary:
      "F-06.4 删除项目（ADR-049）：只有本项目组长与系统管理员可以删除，普通成员 403 PROJECT_DELETE_FORBIDDEN，非成员与不存在（含已删除）一律 404。删除是软删除——项目退出列表、详情、搜索、项目动态与全部项目级读写，业务历史（模块、功能、任务、迭代记录、外部链接）、成员关系与审计链全部保留，可按 SQL 恢复；项目编码继续被占用，不允许被新建项目复用。If-Match 版本不符 409 PROJECT_VERSION_CONFLICT，CSRF 与数据库幂等必填，审计 project.delete 与项目动态在同一事务提交。",
    request: {
      path: "ProjectPath",
      query: "none",
      headers: "ProjectVersionHeaders",
      body: { noBody: true },
    },
    responses: { "204": { noBody: true }, ...errors },
    authPolicy: "session",
    csrfPolicy: "required",
    idempotencyPolicy: "idempotencyRequired",
    idempotencyExceptionAdr: "none",
    idempotencyContractVersion: "1.0.0",
    idempotencyFingerprintVersion: "1.0.0",
    behaviorHeaders: ["If-Match"],
    idempotencyReplayPolicy: deleteReplayPolicy,
    replayAuthorizationPolicy: deleteReplayAuthorization,
    securityFlowPolicy: "none",
    versionPolicy: {
      apiVersion: "v1",
      schemaVersion: "1.0.0",
      ifMatch: "required",
    },
    concurrencyPolicy: {
      rowVersion: "required",
      lockOrder: ["project"],
      retry: "none; project FOR UPDATE, expected row_version",
    },
    auditAction: "project.delete",
  },
  {
    method: "POST",
    path: "/projects/{projectId}/restore",
    operationId: "restoreProject",
    summary:
      "ADR-051 还原项目：撤销 ADR-049 的软删除，项目重新回到列表、详情、搜索、项目动态与全部项目级读写；只有系统管理员与本项目组长可以还原（普通成员 403 PROJECT_RESTORE_FORBIDDEN，非成员与不存在 404），未被删除的项目 409 PROJECT_NOT_DELETED。项目编码、成员关系、任务与审计链从未被删除，因此还原不恢复任何数据，只清空 deleted_at/deleted_by 并递增 row_version；CSRF 与数据库幂等必填，审计 project.restore、项目动态与搜索投影在同一事务提交。",
    request: {
      path: "ProjectPath",
      query: "none",
      headers: "ProjectMutationHeaders",
      body: { noBody: true },
    },
    responses: { "200": json("ProjectDetailResponse"), ...errors },
    authPolicy: "session",
    csrfPolicy: "required",
    idempotencyPolicy: "idempotencyRequired",
    idempotencyExceptionAdr: "none",
    idempotencyContractVersion: "1.0.0",
    idempotencyFingerprintVersion: "1.0.0",
    behaviorHeaders: [],
    idempotencyReplayPolicy: replayPolicy,
    replayAuthorizationPolicy: replayAuthorization,
    securityFlowPolicy: "none",
    // 还原的并发控制由行锁与「仍未删除」守卫实现，不依赖 If-Match：删除台账
    // 不暴露 row_version，而两个并发的还原中必有一个被守卫拦下并得到 409。
    versionPolicy: "none",
    concurrencyPolicy: {
      rowVersion: "none",
      lockOrder: ["project"],
      retry: "none; project FOR UPDATE then deleted_at guard",
    },
    auditAction: "project.restore",
  },
  {
    method: "POST",
    path: "/projects/{projectId}/purge",
    operationId: "purgeProject",
    summary:
      "ADR-051 彻底删除项目：只有系统管理员可以调用（其余身份 403 PROJECT_PURGE_FORBIDDEN），且只接受已经软删除的项目（未删除 409 PROJECT_NOT_DELETED，项目不存在 404）。服务端在同一事务内按外键顺序物理删除该项目的全部业务行（模块、功能、任务、聚合组、迭代记录、遗留项、外部链接、通知、动态与搜索投影）与它自己的 PROJECT 审计链，并返回删除行数统计；SYSTEM 审计链新增一条 project.purge 作为不可变留痕（操作者、项目编码与名称、删除行数），这是本操作唯一保留的记录，不可撤销。CSRF 与数据库幂等必填。",
    request: {
      path: "ProjectPath",
      query: "none",
      headers: "ProjectMutationHeaders",
      body: { noBody: true },
    },
    responses: { "200": json("ProjectPurgeResponse"), ...errors },
    authPolicy: "session",
    csrfPolicy: "required",
    idempotencyPolicy: "idempotencyRequired",
    idempotencyExceptionAdr: "none",
    idempotencyContractVersion: "1.0.0",
    idempotencyFingerprintVersion: "1.0.0",
    behaviorHeaders: [],
    idempotencyReplayPolicy: purgeReplayPolicy,
    replayAuthorizationPolicy: purgeReplayAuthorization,
    securityFlowPolicy: "none",
    versionPolicy: "none",
    concurrencyPolicy: {
      rowVersion: "none",
      lockOrder: ["project"],
      retry: "none; project FOR UPDATE then soft-delete guard",
    },
    auditAction: "project.purge",
  },
  {
    method: "GET",
    path: "/project-deletions",
    operationId: "listProjectDeletions",
    summary:
      "ADR-050 项目删除记录：全部登录用户可读的删除台账，只返回项目编号、项目名称、删除时间与删除人，按删除时间倒序、服务端签名游标分页。删除记录不构成已删除项目重新可见：列表、详情、搜索、项目动态、任务中心与全部项目级读写仍不返回已被删除的项目与业务数据。",
    request: {
      path: "none",
      query: "ProjectDeletionQueryRequest",
      headers: "none",
      body: { noBody: true },
    },
    responses: {
      "200": json("ProjectDeletionPage"),
      "401": json("ErrorResponse"),
      "422": json("ErrorResponse"),
      "500": json("ErrorResponse"),
    },
    authPolicy: "session",
    csrfPolicy: "none",
    idempotencyPolicy: "none",
    idempotencyExceptionAdr: "none",
    idempotencyContractVersion: "none",
    idempotencyFingerprintVersion: "none",
    behaviorHeaders: "none",
    idempotencyReplayPolicy: "none",
    replayAuthorizationPolicy: "none",
    securityFlowPolicy: "none",
    versionPolicy: "none",
    concurrencyPolicy: "none",
    auditAction: "none",
  },
];
