import { recordDraftRoutes } from "./record-draft-routes.js";
import type { RouteDefinition } from "./route-definition.js";
import type { SchemaName } from "./schema-registry.js";
const json = (schemaRef: SchemaName) => ({
  body: {
    contentTypes: [{ contentType: "application/json" as const, schemaRef }],
  },
});
export const publishedRecordRoutes: readonly RouteDefinition[] = (
  [
    "listChangeRecords",
    "getChangeRecord",
    "listChangeRecordVersions",
    "getChangeRecordVersion",
  ] as const
).map((operationId) => {
  const list = operationId === "listChangeRecords",
    version = operationId === "getChangeRecordVersion",
    versions = operationId === "listChangeRecordVersions" || version;
  return {
    operationId,
    method: "GET",
    path: `/projects/{projectId}/change-records${list ? "" : "/{recordId}"}${versions ? "/versions" : ""}${version ? "/{versionNo}" : ""}`,
    summary: "当前有权项目内的正式记录与不可变版本",
    request: {
      path: list
        ? "RecordDraftProjectPath"
        : version
          ? "ChangeRecordVersionPath"
          : "RecordDraftResourcePath",
      query: list ? "RecordListQuery" : "none",
      headers: "none",
      body: { noBody: true },
    },
    responses: {
      "200": json(
        list
          ? "ReadableRecordPage"
          : version
            ? "ChangeRecordVersion"
            : versions
              ? "ChangeRecordVersionList"
              : "ReadableRecord",
      ),
      "401": json("ErrorResponse"),
      "404": json("ErrorResponse"),
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
  };
});

const fields = [
  "id",
  "projectId",
  "moduleId",
  "featureId",
  "scopeType",
  "taskId",
  "impactFeatureIds[]",
  "handlerId",
  "authorId",
  "status",
  "code",
  "currentVersion",
  "publishedAt",
  "rowVersion",
  "createdAt",
  "updatedAt",
  "title",
  "contextProblem",
  "changeSolution",
  "resultVerification",
  "remainingIssues",
  "leftovers[].id",
  "leftovers[].content",
  "leftovers[].status",
  "leftovers[].rowVersion",
  "leftoverItem",
  "leftoverItem.id",
  "leftoverItem.status",
  "leftoverItem.rowVersion",
  "leftoverItem.linkedTaskId",
];
export const recordPublicationRoutes: readonly RouteDefinition[] = (
  ["publishChangeRecord", "createChangeRecordVersion"] as const
).map((operationId) => {
  const publish = operationId === "publishChangeRecord";
  return {
    ...recordDraftRoutes[3]!,
    operationId,
    method: "POST",
    path:
      "/projects/{projectId}/change-records/{recordId}/" +
      (publish ? "publish" : "versions"),
    summary: publish
      ? "发布已保存草稿，来源为空或当前DONE"
      : "保存不可变新版本，保留身份和历史",
    request: {
      path: "RecordDraftResourcePath",
      query: "none",
      headers: publish
        ? "RecordDraftVersionHeaders"
        : "PublishedRecordVersionHeaders",
      body: {
        contentTypes: [
          {
            contentType: "application/json",
            schemaRef: publish
              ? "PublishRecordRequest"
              : "PublishedRecordContent",
          },
        ],
      },
    },
    responses: {
      "200": json("PublishedRecord"),
      ...Object.fromEntries(
        [400, 401, 403, 404, 409, 422, 429, 500].map((status) => [
          String(status),
          json("ErrorResponse"),
        ]),
      ),
    },
    behaviorHeaders: publish ? ["If-Match"] : ["If-Match", "X-Record-Version"],
    idempotencyReplayPolicy: {
      version: "1.0.0",
      success: {
        "200": {
          body: {
            responseSchemaRef: "PublishedRecord",
            safeBodyFieldPaths: fields,
          },
        },
      },
    },
    replayAuthorizationPolicy: {
      version: "1.0.0",
      resources: {
        contextSchemaRef: "RecordPublicationReplayContext",
        resultRefExtractor: "recordPublicationResources",
        currentReadAuthorizer: "recordPublicationCurrentReadAuthorizer",
      },
    },
    concurrencyPolicy: {
      rowVersion: "required",
      lockOrder: publish
        ? [
            "project",
            "module",
            "feature",
            "task",
            "changeRecord",
            "leftoverItem",
          ]
        : ["project", "module", "feature", "changeRecord", "leftoverItem"],
      retry:
        "source pre-read changes release savepoint locks and retry at most 3 times",
    },
    auditAction: publish ? "record.publish" : "record.version.create",
  };
});

export const recordLifecycleRoutes: readonly RouteDefinition[] = (
  ["voidChangeRecord", "restoreChangeRecord"] as const
).map((operationId) => ({
  ...recordDraftRoutes[3]!,
  operationId,
  method: "POST",
  path:
    "/projects/{projectId}/change-records/{recordId}/" +
    (operationId === "voidChangeRecord" ? "void" : "restore"),
  summary: "ADR-024 管理员作废/恢复；只改记录状态及同事务审计/投影",
  authPolicy: "adminSessionWithReauthentication",
  request: {
    path: "RecordDraftResourcePath",
    query: "none",
    headers: "RecordDraftVersionHeaders",
    body: {
      contentTypes: [
        {
          contentType: "application/json",
          schemaRef: "RecordLifecycleRequest",
        },
      ],
    },
  },
  responses: {
    "200": json("RecordLifecycleResult"),
    ...Object.fromEntries(
      [400, 401, 403, 404, 409, 422, 429, 500].map((status) => [
        String(status),
        json("ErrorResponse"),
      ]),
    ),
  },
  behaviorHeaders: ["If-Match"],
  idempotencyReplayPolicy: {
    version: "1.0.0",
    success: {
      "200": {
        body: {
          responseSchemaRef: "RecordLifecycleResult",
          safeBodyFieldPaths: ["id", "projectId", "status", "rowVersion"],
        },
      },
    },
  },
  replayAuthorizationPolicy: {
    version: "1.0.0",
    resources: {
      contextSchemaRef: "RecordLifecycleReplayContext",
      resultRefExtractor: "recordLifecycleResources",
      currentReadAuthorizer: "recordLifecycleCurrentReadAuthorizer",
    },
  },
  concurrencyPolicy: {
    rowVersion: "required",
    lockOrder: ["project", "module", "feature", "changeRecord"],
    retry:
      "none; lock ownership parents then conditional status and row_version update",
  },
  auditAction:
    operationId === "voidChangeRecord"
      ? "CHANGE_RECORD_VOIDED"
      : "CHANGE_RECORD_RESTORED",
}));
