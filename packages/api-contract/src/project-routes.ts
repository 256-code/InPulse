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
];
