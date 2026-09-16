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

/** ProjectArchiveRequestItem 的完整叶子字段；申请与审核重放必须逐字段声明。 */
const projectArchiveRequestFields = [
  "id",
  "projectId",
  "requestedBy",
  "requestedByName",
  "reason",
  "status",
  "requestedAt",
  "decidedBy",
  "decidedByName",
  "decidedAt",
  "decisionNote",
  "rowVersion",
] as const;

/** ADR-034 项目归档申请响应（提交与驳回）的幂等重放策略。 */
const archiveRequestReplayPolicy = {
  version: "1.0.0",
  success: {
    "200": {
      body: {
        responseSchemaRef: "ProjectArchiveRequestItem" as const,
        safeBodyFieldPaths: projectArchiveRequestFields,
      },
    },
  },
} as const;

/** 申请与审核都以项目 + 申请为最小结果资源，重放前复核当前可读性与门禁。 */
const archiveRequestReplayAuthorization = {
  version: "1.0.0",
  resources: {
    contextSchemaRef: "ProjectArchiveRequestReplayContext" as const,
    resultRefExtractor: "projectId",
    currentReadAuthorizer: "projectCurrentReadAuthorizer",
  },
} as const;

export const projectRoutes: readonly RouteDefinition[] = [
  {
    method: "PATCH",
    path: "/projects/{projectId}",
    operationId: "updateProject",
    summary:
      "项目活跃成员或系统管理员编辑项目名称与描述；编码不可修改，If-Match 乐观锁防并发覆盖，审计、活动与搜索投影在同一事务提交；归档项目只读返回 409。",
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
    idempotencyContractVersion: "1.3.0",
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
    method: "GET",
    path: "/projects/{projectId}/archive-preview",
    operationId: "getProjectArchivePreview",
    summary:
      "系统管理员在归档前读取未完成任务数提醒；要求当前有效的完整管理员 Session（is_admin），不要求 CSRF 或幂等键。",
    request: {
      path: "ProjectPath",
      query: "none",
      headers: "none",
      body: { noBody: true },
    },
    responses: {
      "200": json("ProjectArchivePreviewResponse"),
      ...errors,
    },
    authPolicy: "adminSession",
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
  ...(["archiveProject", "restoreProject"] as const).map(
    (operationId): RouteDefinition => {
      const archive = operationId === "archiveProject";
      const action = archive ? "archive" : "restore";
      return {
        method: "POST",
        path: `/projects/{projectId}/${action}`,
        operationId,
        summary: archive
          ? "系统管理员归档项目：原因、If-Match、CSRF 与数据库幂等必填且要求当前有效的完整管理员 Session（is_admin）；归档后全部下级只读、历史仍可读，审计、活动与搜索投影在同一事务更新。"
          : "系统管理员恢复已归档项目：原因、If-Match、CSRF 与数据库幂等必填且要求当前有效的完整管理员 Session（is_admin）；只恢复项目自身状态、不改变下级数据，审计、活动与搜索投影在同一事务更新。",
        request: {
          path: "ProjectPath",
          query: "none",
          headers: "ProjectVersionHeaders",
          body: {
            contentTypes: [
              {
                contentType: "application/json",
                schemaRef: "ProjectArchiveRequest",
              },
            ],
          },
        },
        responses: { "200": json("ProjectDetailResponse"), ...errors },
        authPolicy: "adminSession",
        csrfPolicy: "required",
        idempotencyPolicy: "idempotencyRequired",
        idempotencyExceptionAdr: "none",
        // ADR-033：详情响应新增 currentUserRole，重放安全字段变化，旧 Key 409。
        // 2026-09-16：项目统计新增 completedTaskCount，重放安全字段变化，旧 Key 409。
        idempotencyContractVersion: "1.3.0",
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
        auditAction: `project.${action}`,
      };
    },
  ),
  {
    method: "POST",
    path: "/projects/{projectId}/archive-requests",
    operationId: "requestProjectArchive",
    summary:
      "ADR-034 项目归档申请：本项目组长、项目管理员或系统管理员提交；项目必须处于 ACTIVE 且项目下没有未完成任务，同一项目同时只允许一条待审申请；申请不改变项目状态，审计、活动与通知全部系统管理员的站内通知在同一事务提交；项目已归档或仍有未完成任务返回 409。",
    request: {
      path: "ProjectPath",
      query: "none",
      headers: "ProjectMutationHeaders",
      body: {
        contentTypes: [
          {
            contentType: "application/json",
            schemaRef: "ProjectArchiveRequestSubmission",
          },
        ],
      },
    },
    responses: { "200": json("ProjectArchiveRequestItem"), ...errors },
    authPolicy: "session",
    csrfPolicy: "required",
    idempotencyPolicy: "idempotencyRequired",
    idempotencyExceptionAdr: "none",
    idempotencyContractVersion: "1.0.0",
    idempotencyFingerprintVersion: "1.0.0",
    behaviorHeaders: [],
    idempotencyReplayPolicy: archiveRequestReplayPolicy,
    replayAuthorizationPolicy: archiveRequestReplayAuthorization,
    securityFlowPolicy: "none",
    versionPolicy: {
      apiVersion: "v1",
      schemaVersion: "1.0.0",
      ifMatch: "none",
    },
    concurrencyPolicy: {
      rowVersion: "none",
      lockOrder: ["project"],
      retry: "项目 FOR SHARE；待审申请唯一索引冲突映射 409，不自动重试",
    },
    auditAction: "project.archive.request",
  },
  {
    method: "POST",
    path: "/projects/{projectId}/archive-requests/{requestId}/approve",
    operationId: "approveProjectArchive",
    summary:
      "ADR-034 系统管理员批准项目归档申请：要求当前有效的完整管理员 Session、CSRF、If-Match 与数据库幂等；批准在同一事务内归档项目、把申请置为 APPROVED 并通知申请人，项目状态、申请状态、审计、活动与搜索投影一起提交。",
    request: {
      path: "ProjectArchiveRequestPath",
      query: "none",
      headers: "ProjectVersionHeaders",
      body: { noBody: true },
    },
    responses: { "200": json("ProjectDetailResponse"), ...errors },
    authPolicy: "adminSession",
    csrfPolicy: "required",
    idempotencyPolicy: "idempotencyRequired",
    idempotencyExceptionAdr: "none",
    idempotencyContractVersion: "1.0.0",
    idempotencyFingerprintVersion: "1.0.0",
    behaviorHeaders: ["If-Match"],
    idempotencyReplayPolicy: replayPolicy,
    replayAuthorizationPolicy: archiveRequestReplayAuthorization,
    securityFlowPolicy: "none",
    versionPolicy: {
      apiVersion: "v1",
      schemaVersion: "1.0.0",
      ifMatch: "required",
    },
    concurrencyPolicy: {
      rowVersion: "required",
      lockOrder: ["project"],
      retry:
        "项目 FOR UPDATE，申请行 FOR UPDATE；版本或状态冲突映射 409，不自动重试",
    },
    auditAction: "project.archive.approve",
  },
  {
    method: "POST",
    path: "/projects/{projectId}/archive-requests/{requestId}/reject",
    operationId: "rejectProjectArchive",
    summary:
      "ADR-034 系统管理员驳回项目归档申请：要求当前有效的完整管理员 Session、CSRF 与数据库幂等；只把申请置为 REJECTED 并记录可选批注，项目状态不变，审计与通知申请人同一事务提交。",
    request: {
      path: "ProjectArchiveRequestPath",
      query: "none",
      headers: "ProjectMutationHeaders",
      body: {
        contentTypes: [
          {
            contentType: "application/json",
            schemaRef: "ProjectArchiveRejectionRequest",
          },
        ],
      },
    },
    responses: { "200": json("ProjectArchiveRequestItem"), ...errors },
    authPolicy: "adminSession",
    csrfPolicy: "required",
    idempotencyPolicy: "idempotencyRequired",
    idempotencyExceptionAdr: "none",
    idempotencyContractVersion: "1.0.0",
    idempotencyFingerprintVersion: "1.0.0",
    behaviorHeaders: [],
    idempotencyReplayPolicy: archiveRequestReplayPolicy,
    replayAuthorizationPolicy: archiveRequestReplayAuthorization,
    securityFlowPolicy: "none",
    versionPolicy: {
      apiVersion: "v1",
      schemaVersion: "1.0.0",
      ifMatch: "none",
    },
    concurrencyPolicy: {
      rowVersion: "none",
      lockOrder: ["project"],
      retry:
        "项目 FOR SHARE，申请行 FOR UPDATE；非 PENDING 状态映射 409，不自动重试",
    },
    auditAction: "project.archive.reject",
  },
];
