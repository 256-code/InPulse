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
const fields = [
  "id",
  "projectId",
  "name",
  "currentBehavior",
  "moduleId",
  "code",
  "createdBy",
  "tags[]",
  "status",
  "rowVersion",
  "createdAt",
  "updatedAt",
  "archivedAt",
];
export const featureRoutes: readonly RouteDefinition[] = [
  {
    method: "GET",
    path: "/projects/{projectId}/modules/{moduleId}/features",
    operationId: "listFeatures",
    summary: "读取可访问项目的全部功能，含归档历史，按 id 升序。",
    request: {
      path: "FeatureCollectionPath",
      query: "none",
      headers: "none",
      body: { noBody: true },
    },
    responses: { "200": json("FeatureListResponse"), ...errors },
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
  {
    method: "GET",
    path: "/projects/{projectId}/modules/{moduleId}/features/similar",
    operationId: "findSimilarFeatures",
    summary: "当前项目最多十个关键词候选，含归档，不自动阻止创建或合并。",
    request: {
      path: "FeatureCollectionPath",
      query: "FeatureSimilarQuery",
      headers: "none",
      body: { noBody: true },
    },
    responses: { "200": json("FeatureListResponse"), ...errors },
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
  {
    method: "GET",
    path: "/projects/{projectId}/modules/{moduleId}/features/{featureId}",
    operationId: "getFeature",
    summary: "按完整项目和模块归属读取功能详情，含归档历史。",
    request: {
      path: "FeatureResourcePath",
      query: "none",
      headers: "none",
      body: { noBody: true },
    },
    responses: { "200": json("FeatureItem"), ...errors },
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
  ...(
    [
      "createFeature",
      "updateFeature",
      "archiveFeature",
      "restoreFeature",
    ] as const
  ).map((operationId): RouteDefinition => {
    const create = operationId === "createFeature";
    const update = operationId === "updateFeature";
    const highRisk = !create && !update;
    const action = create
      ? "create"
      : update
        ? "update"
        : operationId === "archiveFeature"
          ? "archive"
          : "restore";
    return {
      method: update ? "PATCH" : "POST",
      path: `/projects/{projectId}/modules/{moduleId}/features${create ? "" : `/{featureId}${highRisk ? `/${action}` : ""}`}`,
      operationId,
      summary: `${action} 功能；项目可写，项目/模块/编号/创建者不可变；归档/恢复需管理员重认证与原因。`,
      request: {
        path: create ? "FeatureCollectionPath" : "FeatureResourcePath",
        query: "none",
        headers: create ? "FeatureMutationHeaders" : "FeatureVersionHeaders",
        body: {
          contentTypes: [
            {
              contentType: "application/json",
              schemaRef: highRisk
                ? "FeatureArchiveRequest"
                : "FeatureEditRequest",
            },
          ],
        },
      },
      responses: { "200": json("FeatureItem"), ...errors },
      authPolicy: highRisk ? "adminSessionWithReauthentication" : "session",
      csrfPolicy: "required",
      idempotencyPolicy: "idempotencyRequired",
      idempotencyExceptionAdr: "none",
      idempotencyContractVersion: "1.0.0",
      idempotencyFingerprintVersion: "1.0.0",
      behaviorHeaders: create ? [] : ["If-Match"],
      idempotencyReplayPolicy: {
        version: "1.0.0",
        success: {
          "200": {
            body: {
              responseSchemaRef: "FeatureItem",
              safeBodyFieldPaths: fields,
            },
          },
        },
      },
      replayAuthorizationPolicy: {
        version: "1.0.0",
        resources: {
          contextSchemaRef: "FeatureReplayContext",
          resultRefExtractor: "featureResultResource",
          currentReadAuthorizer: "featureCurrentReadAuthorizer",
        },
      },
      securityFlowPolicy: "none",
      versionPolicy: {
        apiVersion: "v1",
        schemaVersion: "1.0.0",
        ifMatch: create ? "none" : "required",
      },
      concurrencyPolicy: {
        rowVersion: create ? "none" : "required",
        lockOrder: create
          ? ["project", "module"]
          : ["project", "module", "feature"],
        retry:
          "none; parent FOR SHARE, feature FOR UPDATE, expected row_version",
      },
      auditAction: `feature.${action}`,
    };
  }),
];
