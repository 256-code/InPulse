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
  "code",
  "name",
  "description",
  "kind",
  "sortOrder",
  "rowVersion",
  "createdAt",
  "updatedAt",
  "stats.activeFeatureCount",
  "stats.openTaskCount",
  "stats.completedTaskCount",
];
/** ADR-059：删除模块重放可安全回述的影响面计数。 */
const moduleDeletionFields = [
  "id",
  "projectId",
  "code",
  "name",
  "kind",
  "deletedAt",
  "deletedBy",
  "deletedFeatureCount",
  "deletedTaskCount",
  "voidedRecordCount",
  "removedLinkCount",
];
export const moduleRoutes: readonly RouteDefinition[] = [
  {
    method: "GET",
    path: "/projects/{projectId}/modules",
    operationId: "listModules",
    summary:
      "读取可访问项目的全部模块；先按派生档位（进行中、未开始）排序，同档位内按创建时间从近到远、创建时间相同时按模块 ID 降序（ADR-044：模块已无归档态；2026-09-24 起排序键不再使用 sort_order）。",
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
  ...(["createModule", "updateModule"] as const).map(
    (operationId): RouteDefinition => {
      const create = operationId === "createModule";
      const action = create ? "create" : "update";
      return {
        method: create ? "POST" : "PATCH",
        path: `/projects/{projectId}/modules${create ? "" : "/{moduleId}"}`,
        operationId,
        summary: `${create ? "创建" : "更新"}模块；项目可写，未分类身份不可变。`,
        request: {
          path: create ? "ModuleProjectPath" : "ModuleResourcePath",
          query: "none",
          headers: create ? "ModuleMutationHeaders" : "ModuleVersionHeaders",
          body: {
            contentTypes: [
              {
                contentType: "application/json",
                schemaRef: "ModuleEditRequest",
              },
            ],
          },
        },
        responses: { "200": json("ModuleItem"), ...errors },
        authPolicy: "session",
        csrfPolicy: "required",
        idempotencyPolicy: "idempotencyRequired",
        idempotencyExceptionAdr: "none",
        // ADR-044：模块下线归档后 ModuleItem 去掉 status / archivedAt，
        // 重放安全字段集合随响应 Schema 变化，旧 Key 在新契约下 409。
        idempotencyContractVersion: "1.4.0",
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
    },
  ),
  {
    // ADR-059：删除模块为新增命令。模块软删除后退出全部读写范围，
    // 级联软删除其功能与任务（任务按 ADR-058 单任务语义），历史与审计保留。
    method: "POST",
    path: "/projects/{projectId}/modules/{moduleId}/delete",
    operationId: "deleteModule",
    summary:
      "删除模块：同一事务级联删除其功能与任务、作废相关迭代记录并保留审计与动态（ADR-059）。",
    request: {
      path: "ModuleResourcePath",
      query: "none",
      headers: "ModuleVersionHeaders",
      body: {
        contentTypes: [
          {
            contentType: "application/json",
            schemaRef: "DeleteModuleRequest",
          },
        ],
      },
    },
    responses: { "200": json("ModuleDeletionResponse"), ...errors },
    authPolicy: "session",
    csrfPolicy: "required",
    idempotencyPolicy: "idempotencyRequired",
    idempotencyExceptionAdr: "none",
    idempotencyContractVersion: "1.0.0",
    idempotencyFingerprintVersion: "1.0.0",
    behaviorHeaders: ["If-Match"],
    idempotencyReplayPolicy: {
      version: "1.0.0",
      success: {
        "200": {
          body: {
            responseSchemaRef: "ModuleDeletionResponse",
            safeBodyFieldPaths: moduleDeletionFields,
          },
        },
      },
    },
    replayAuthorizationPolicy: {
      version: "1.0.0",
      resources: {
        contextSchemaRef: "ModuleDeletionReplayContext",
        resultRefExtractor: "moduleDeletionResources",
        currentReadAuthorizer: "moduleDeleteReplayAuthorizer",
      },
    },
    securityFlowPolicy: "none",
    versionPolicy: {
      apiVersion: "v1",
      schemaVersion: "1.0.0",
      ifMatch: "required",
    },
    concurrencyPolicy: {
      rowVersion: "required",
      lockOrder: ["project", "module", "feature", "task", "taskGroup"],
      retry:
        "parents FOR SHARE, module FOR UPDATE; cascaded tasks FOR UPDATE in ascending id order and change records voided in ascending id order inside the same transaction",
    },
    auditAction: "module.delete",
  },
];
