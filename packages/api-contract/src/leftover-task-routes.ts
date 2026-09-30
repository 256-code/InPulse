import {
  recordPublicationRoutes,
  publishedRecordRoutes,
} from "./published-record-routes.js";
import type { RouteDefinition } from "./route-definition.js";
const write = recordPublicationRoutes[0]!,
  read = publishedRecordRoutes[0]!;
const json = (
  schemaRef:
    "LeftoverTaskResponse" | "LeftoverTaskPreview" | "LeftoverTaskSource",
) => ({
  body: { contentTypes: [{ contentType: "application/json", schemaRef }] },
});
export const leftoverTaskRoutes: readonly RouteDefinition[] = [
  {
    ...write,
    operationId: "convertLeftoverToTask",
    path: "/projects/{projectId}/change-records/{recordId}/leftover-task",
    summary: "把当前正式版本稳定遗留转为唯一跟进任务",
    request: {
      path: "RecordDraftResourcePath",
      headers: "RecordDraftVersionHeaders",
      query: "none",
      body: {
        contentTypes: [
          { contentType: "application/json", schemaRef: "LeftoverTaskRequest" },
        ],
      },
    },
    responses: { ...write.responses, "200": json("LeftoverTaskResponse") },
    auditAction: "leftover.convert",
    // 2026-09-30：请求 Schema 增加可选 description（任务说明），请求侧语义变化，
    // 幂等契约版本与请求 Schema 版本一起升到 1.2.0；摘要格式与重放策略未变。
    idempotencyContractVersion: "1.2.0",
    idempotencyFingerprintVersion: "1.2.0",
    behaviorHeaders: ["If-Match"],
    idempotencyReplayPolicy: {
      version: "1.0.0",
      success: {
        "200": {
          body: {
            responseSchemaRef: "LeftoverTaskResponse",
            safeBodyFieldPaths: [
              "projectId",
              "moduleId",
              "featureId",
              "taskId",
              "recordId",
              "leftoverItemId",
              "recordVersion",
              "recordRowVersion",
              "leftoverRowVersion",
              "impactFeatureIds[]",
            ],
          },
        },
      },
    },
    replayAuthorizationPolicy: {
      version: "1.0.0",
      resources: {
        contextSchemaRef: "LeftoverTaskReplayContext",
        resultRefExtractor: "leftoverTaskResources",
        currentReadAuthorizer: "leftoverTaskCurrentReadAuthorizer",
      },
    },
    concurrencyPolicy: {
      rowVersion: "required",
      lockOrder: [
        "project",
        "module",
        "feature",
        "changeRecord",
        "leftoverItem",
      ],
      retry:
        "Prelock all record and result impact features; bounded retry before creating a new task",
    },
  },
  {
    ...read,
    operationId: "previewLeftoverTask",
    path: "/projects/{projectId}/change-records/{recordId}/leftover-task-preview",
    summary: "预览遗留转任务的服务端影响继承；可指定要处理的遗留项",
    request: {
      ...read.request,
      query: "LeftoverTaskPreviewQuery",
      path: "RecordDraftResourcePath",
    },
    responses: { ...read.responses, "200": json("LeftoverTaskPreview") },
  },
  {
    ...read,
    operationId: "getLeftoverTaskSource",
    path: "/tasks/{taskId}/leftover-source",
    summary: "读取跟进任务的已授权来源记录",
    request: { ...read.request, query: "none", path: "TaskCompletionPath" },
    responses: { ...read.responses, "200": json("LeftoverTaskSource") },
  },
];
