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
    idempotencyContractVersion: "1.0.0",
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
      "系统管理员在归档前读取未完成任务数提醒；要求完整管理员 Session 且密码与当前 TOTP 重认证均在 5 分钟内，不要求 CSRF 或幂等键。",
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
    authPolicy: "adminSessionWithReauthentication",
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
          ? "系统管理员归档项目：原因、If-Match、CSRF 与数据库幂等必填且要求 5 分钟内密码/TOTP 重认证；归档后全部下级只读、历史仍可读，审计、活动与搜索投影在同一事务更新。"
          : "系统管理员恢复已归档项目：原因、If-Match、CSRF 与数据库幂等必填且要求 5 分钟内密码/TOTP 重认证；只恢复项目自身状态、不改变下级数据，审计、活动与搜索投影在同一事务更新。",
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
        authPolicy: "adminSessionWithReauthentication",
        csrfPolicy: "required",
        idempotencyPolicy: "idempotencyRequired",
        idempotencyExceptionAdr: "none",
        idempotencyContractVersion: "1.0.0",
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
];
