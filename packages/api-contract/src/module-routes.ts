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
  "description",
  "kind",
  "status",
  "sortOrder",
  "rowVersion",
  "createdAt",
  "updatedAt",
  "archivedAt",
];
export const moduleRoutes: readonly RouteDefinition[] = [
  {
    method: "GET",
    path: "/projects/{projectId}/modules",
    operationId: "listModules",
    summary: "读取可访问项目的全部模块，含归档历史，按 sort_order、id 升序。",
    request: {
      path: "ModuleProjectPath",
      query: "none",
      headers: "none",
      body: { noBody: true },
    },
    responses: { "200": json("ModuleListResponse"), ...errors },
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
    ["createModule", "updateModule", "archiveModule", "restoreModule"] as const
  ).map((operationId): RouteDefinition => {
    const create = operationId === "createModule";
    const update = operationId === "updateModule";
    const highRisk = !create && !update;
    const action = create
      ? "create"
      : update
        ? "update"
        : operationId === "archiveModule"
          ? "archive"
          : "restore";
    return {
      method: update ? "PATCH" : "POST",
      path: `/projects/{projectId}/modules${create ? "" : `/{moduleId}${highRisk ? `/${action}` : ""}`}`,
      operationId,
      summary: `${action} 模块；项目可写，未分类身份不可变；归档/恢复需管理员重认证与原因。`,
      request: {
        path: create ? "ModuleProjectPath" : "ModuleResourcePath",
        query: "none",
        headers: create ? "ModuleMutationHeaders" : "ModuleVersionHeaders",
        body: {
          contentTypes: [
            {
              contentType: "application/json",
              schemaRef: highRisk
                ? "ModuleArchiveRequest"
                : "ModuleEditRequest",
            },
          ],
        },
      },
      responses: { "200": json("ModuleItem"), ...errors },
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
              responseSchemaRef: "ModuleItem",
              safeBodyFieldPaths: fields,
            },
          },
        },
      },
      replayAuthorizationPolicy: {
        version: "1.0.0",
        resources: {
          contextSchemaRef: "ModuleReplayContext",
          resultRefExtractor: "moduleResultResource",
          currentReadAuthorizer: "moduleCurrentReadAuthorizer",
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
        lockOrder: create ? ["project"] : ["project", "module"],
        retry:
          "none; parent FOR SHARE, module FOR UPDATE, expected row_version",
      },
      auditAction: `module.${action}`,
    };
  }),
];
