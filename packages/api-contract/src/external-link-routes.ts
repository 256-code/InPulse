import { recordDraftRoutes } from "./record-draft-routes.js";
import { publishedRecordRoutes } from "./published-record-routes.js";
import type { RouteDefinition } from "./route-definition.js";
import type { SchemaName } from "./schema-registry.js";
const json = (schemaRef: SchemaName) => ({
  body: { contentTypes: [{ contentType: "application/json", schemaRef }] },
});
export const externalLinkRoutes: readonly RouteDefinition[] = [
  "listExternalLinks",
  "addExternalLink",
  "removeExternalLink",
].map((operationId) => {
  const write = operationId !== "listExternalLinks",
    remove = operationId === "removeExternalLink";
  return {
    ...(write ? recordDraftRoutes[3]! : publishedRecordRoutes[1]!),
    operationId,
    method: write ? (remove ? "DELETE" : "POST") : "GET",
    path:
      "/external-links/{targetType}/{targetId}" + (remove ? "/{linkId}" : ""),
    summary: write
      ? "管理目标的当前GitHub关联并保留实体和审计"
      : "读取当前有权目标的GitHub关联",
    request: {
      path: remove ? "ExternalLinkResourcePath" : "ExternalLinkTargetPath",
      query: "none",
      headers: write ? "RecordDraftVersionHeaders" : "none",
      body:
        write && !remove
          ? {
              contentTypes: [
                {
                  contentType: "application/json",
                  schemaRef: "ExternalLinkRequest",
                },
              ],
            }
          : { noBody: true },
    },
    responses: {
      "200": json(write ? "ExternalLinkResult" : "ExternalLinkList"),
      "400": json("ErrorResponse"),
      "401": json("ErrorResponse"),
      "403": json("ErrorResponse"),
      "404": json("ErrorResponse"),
      "409": json("ErrorResponse"),
      "422": json("ErrorResponse"),
      "429": json("ErrorResponse"),
      "500": json("ErrorResponse"),
    },
    auditAction: write
      ? remove
        ? "EXTERNAL_LINK_REMOVED"
        : "EXTERNAL_LINK_ADDED"
      : "none",
    behaviorHeaders: write ? ["If-Match"] : "none",
    idempotencyReplayPolicy: write
      ? {
          version: "1.0.0",
          success: {
            "200": {
              body: {
                responseSchemaRef: "ExternalLinkResult",
                safeBodyFieldPaths: [
                  "projectId",
                  "targetType",
                  "targetId",
                  "linkId",
                  "rowVersion",
                ],
              },
            },
          },
        }
      : "none",
    replayAuthorizationPolicy: write
      ? {
          version: "1.0.0",
          resources: {
            contextSchemaRef: "ExternalLinkReplayContext",
            resultRefExtractor: "externalLinkTarget",
            currentReadAuthorizer: "externalLinkCurrentRead",
          },
        }
      : "none",
    concurrencyPolicy: write
      ? {
          rowVersion: "required",
          lockOrder: ["project", "module", "feature", "task", "changeRecord"],
          retry:
            "Re-read true ownership after ordered target lock; reject changed version",
        }
      : "none",
  };
});
