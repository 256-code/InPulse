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
const collection =
  "/projects/{projectId}/modules/{moduleId}/features/{featureId}/tasks";
const fields = [
  "id",
  "projectId",
  "moduleId",
  "featureId",
  "scopeType",
  "code",
  "title",
  "description",
  "assigneeId",
  "creatorId",
  "priority",
  "workStatus",
  "lifecycleStatus",
  "dueAt",
  "rowVersion",
  "createdAt",
  "updatedAt",
];
export const taskRoutes: readonly RouteDefinition[] = [
  ...(["listTasks", "getTask", "listTaskAssignees"] as const).map(
    (operationId): RouteDefinition => ({
      method: "GET",
      path: `${collection}${operationId === "getTask" ? "/{taskId}" : operationId === "listTaskAssignees" ? "/assignees" : ""}`,
      operationId,
      summary: "读取真实功能归属下的任务或当前项目可指派成员。",
      request: {
        path:
          operationId === "getTask" ? "TaskResourcePath" : "TaskCollectionPath",
        query: "none",
        headers: "none",
        body: { noBody: true },
      },
      responses: {
        "200": json(
          operationId === "getTask"
            ? "TaskItem"
            : operationId === "listTaskAssignees"
              ? "TaskAssigneesResponse"
              : "TaskListResponse",
        ),
        ...errors,
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
    }),
  ),
  ...(["createTask", "updateTask"] as const).map(
    (operationId): RouteDefinition => {
      const create = operationId === "createTask";
      return {
        method: create ? "POST" : "PATCH",
        path: `${collection}${create ? "" : "/{taskId}"}`,
        operationId,
        summary:
          "功能任务创建或编辑；创建/改派只接受项目活跃成员，保留未变的历史负责人。",
        request: {
          path: create ? "TaskCollectionPath" : "TaskResourcePath",
          query: "none",
          headers: create ? "TaskMutationHeaders" : "TaskVersionHeaders",
          body: {
            contentTypes: [
              { contentType: "application/json", schemaRef: "TaskEditRequest" },
            ],
          },
        },
        responses: { "200": json("TaskItem"), ...errors },
        authPolicy: "session",
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
                responseSchemaRef: "TaskItem",
                safeBodyFieldPaths: fields,
              },
            },
          },
        },
        replayAuthorizationPolicy: {
          version: "1.0.0",
          resources: {
            contextSchemaRef: "TaskReplayContext",
            resultRefExtractor: "taskResultResource",
            currentReadAuthorizer: "taskCurrentReadAuthorizer",
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
            ? ["project", "module", "feature"]
            : ["project", "module", "feature", "task"],
          retry:
            "none; parents FOR SHARE, task FOR UPDATE, then assignee user/membership FOR SHARE",
        },
        auditAction: create ? "task.create" : "task.update",
      };
    },
  ),
];
