import type { BodyBinding, RouteDefinition } from "./route-definition.js";
import type { SchemaName } from "./schema-registry.js";
const json = (schemaRef: SchemaName): BodyBinding => ({
  body: { contentTypes: [{ contentType: "application/json", schemaRef }] },
});
const errors = Object.fromEntries(
  [400, 401, 403, 404, 409, 422, 429, 500].map((status) => [
    String(status),
    json("ErrorResponse"),
  ]),
);
/** 与 TaskGroupItem 的非敏感叶子字段精确相等，顺序无关。 */
const fields = [
  "code",
  "createdAt",
  "createdBy",
  "id",
  "mainTaskId",
  "members[].id",
  "members[].joinedAt",
  "members[].originalAssigneeId",
  "members[].originalWorkStatus",
  "members[].role",
  "members[].sourceKind",
  "members[].status",
  "members[].taskId",
  "name",
  "projectId",
  "rowVersion",
  "status",
  "updatedAt",
];
export const taskGroupRoutes: readonly RouteDefinition[] = [
  {
    method: "POST",
    path: "/task-groups/merge",
    operationId: "mergeTaskGroup",
    summary:
      "把来源任务合并到主任务：校验同项目与生命周期、按 ID 升序加锁、建立或加入聚合组并保存来源快照；不修改任何任务字段，冲突由数据库唯一约束兜底。",
    request: {
      path: "none",
      query: "none",
      headers: "TaskGroupMergeHeaders",
      body: {
        contentTypes: [
          {
            contentType: "application/json",
            schemaRef: "TaskGroupMergeRequest",
          },
        ],
      },
    },
    responses: { "200": json("TaskGroupItem"), ...errors },
    authPolicy: "session",
    csrfPolicy: "required",
    idempotencyPolicy: "idempotencyRequired",
    idempotencyExceptionAdr: "none",
    idempotencyContractVersion: "1.0.0",
    idempotencyFingerprintVersion: "1.0.0",
    behaviorHeaders: [],
    idempotencyReplayPolicy: {
      version: "1.0.0",
      success: {
        "200": {
          body: {
            responseSchemaRef: "TaskGroupItem",
            safeBodyFieldPaths: fields,
          },
        },
      },
    },
    replayAuthorizationPolicy: {
      version: "1.0.0",
      resources: {
        contextSchemaRef: "TaskGroupMergeReplayContext",
        resultRefExtractor: "taskGroupResultResource",
        currentReadAuthorizer: "taskGroupCurrentReadAuthorizer",
      },
    },
    securityFlowPolicy: "none",
    versionPolicy: "none",
    concurrencyPolicy: {
      rowVersion: "none",
      lockOrder: ["project", "module", "feature", "task", "taskGroup"],
      retry:
        "bounded 3 attempts; sorted project/module/feature FOR SHARE then task FOR UPDATE ascending, then group FOR UPDATE with member re-read",
    },
    auditAction: "task.merge",
  },
];
