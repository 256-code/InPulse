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

const readPolicies = {
  authPolicy: "adminSessionWithReauthentication" as const,
  csrfPolicy: "none" as const,
  idempotencyPolicy: "none" as const,
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
} as const;

const replayPolicy = {
  version: "1.0.0",
  success: {
    "200": {
      body: {
        responseSchemaRef: "AddProjectMemberResponse" as const,
        safeBodyFieldPaths: [
          "member.membershipId",
          "member.projectId",
          "member.userId",
          "member.name",
          "member.avatarUrl",
          "member.status",
          "member.joinedAt",
          "member.removedAt",
        ],
      },
    },
  },
} as const;

const removeReplayPolicy = {
  version: "1.0.0",
  success: {
    "200": {
      body: {
        responseSchemaRef: "RemoveProjectMemberResponse" as const,
        safeBodyFieldPaths: [
          "member.membershipId",
          "member.projectId",
          "member.userId",
          "member.name",
          "member.avatarUrl",
          "member.status",
          "member.joinedAt",
          "member.removedAt",
          "reassignedTaskIds[]",
          "unfinishedTaskCount",
        ],
      },
    },
  },
} as const;

const replayAuthorization = {
  version: "1.0.0",
  resources: {
    contextSchemaRef: "ProjectMemberReplayContext" as const,
    resultRefExtractor: "memberUserId",
    currentReadAuthorizer: "projectMemberReadAuthorizer",
  },
} as const;

export const projectMemberRoutes: readonly RouteDefinition[] = [
  {
    method: "GET",
    path: "/projects/{projectId}/members",
    operationId: "listProjectMembers",
    summary:
      "系统管理员读取项目成员完整历史，仅允许最近 5 分钟内完成密码与 TOTP 重认证；普通成员与非成员统一 403/404。",
    request: {
      path: "ProjectMemberCollectionPath",
      query: "none",
      headers: "none",
      body: { noBody: true },
    },
    responses: { "200": json("ProjectMembersListResponse"), ...errors },
    ...readPolicies,
  },
  {
    method: "GET",
    path: "/projects/{projectId}/members/{userId}/unfinished-tasks",
    operationId: "listProjectMemberUnfinishedTasks",
    summary:
      "系统管理员读取项目成员当前未完成任务，用于移除前提示改派或保留原负责人。",
    request: {
      path: "ProjectMemberPath",
      query: "none",
      headers: "none",
      body: { noBody: true },
    },
    responses: {
      "200": json("ProjectMemberUnfinishedTasksResponse"),
      ...errors,
    },
    ...readPolicies,
  },
  {
    method: "POST",
    path: "/projects/{projectId}/members",
    operationId: "addProjectMember",
    summary:
      "系统管理员添加项目成员；已停用或不存在用户 422，重复活跃成员 409，重新加入新增历史记录并同事务发送通知与审计。",
    request: {
      path: "ProjectMemberCollectionPath",
      query: "none",
      headers: "ProjectMemberMutationHeaders",
      body: {
        contentTypes: [
          {
            contentType: "application/json",
            schemaRef: "AddProjectMemberRequest",
          },
        ],
      },
    },
    responses: { "200": json("AddProjectMemberResponse"), ...errors },
    authPolicy: "adminSessionWithReauthentication",
    csrfPolicy: "required",
    idempotencyPolicy: "idempotencyRequired",
    idempotencyExceptionAdr: "none",
    idempotencyContractVersion: "1.0.0",
    idempotencyFingerprintVersion: "1.0.0",
    behaviorHeaders: [],
    idempotencyReplayPolicy: replayPolicy,
    replayAuthorizationPolicy: replayAuthorization,
    securityFlowPolicy: "none",
    versionPolicy: {
      apiVersion: "v1",
      schemaVersion: "1.0.0",
      ifMatch: "none",
    },
    concurrencyPolicy: {
      rowVersion: "none",
      lockOrder: ["project"],
      retry:
        "项目 FOR SHARE，成员历史 FOR UPDATE；活跃唯一索引冲突映射 409，不自动重试",
    },
    auditAction: "project.member.add",
  },
  {
    method: "POST",
    path: "/projects/{projectId}/members/{userId}/remove",
    operationId: "removeProjectMember",
    summary:
      "系统管理员移除项目成员；可同时提交真实任务改派，未改派任务保留原负责人但成员立即失去访问权，同事务写审计与活动。",
    request: {
      path: "ProjectMemberPath",
      query: "none",
      headers: "ProjectMemberMutationHeaders",
      body: {
        contentTypes: [
          {
            contentType: "application/json",
            schemaRef: "RemoveProjectMemberRequest",
          },
        ],
      },
    },
    responses: { "200": json("RemoveProjectMemberResponse"), ...errors },
    authPolicy: "adminSessionWithReauthentication",
    csrfPolicy: "required",
    idempotencyPolicy: "idempotencyRequired",
    idempotencyExceptionAdr: "none",
    idempotencyContractVersion: "1.0.0",
    idempotencyFingerprintVersion: "1.0.0",
    behaviorHeaders: [],
    idempotencyReplayPolicy: removeReplayPolicy,
    replayAuthorizationPolicy: replayAuthorization,
    securityFlowPolicy: "none",
    versionPolicy: {
      apiVersion: "v1",
      schemaVersion: "1.0.0",
      ifMatch: "none",
    },
    concurrencyPolicy: {
      rowVersion: "none",
      lockOrder: ["project", "module", "feature", "task"],
      retry:
        "项目 FOR SHARE，任务按父级与 ID 锁序改派后成员 FOR UPDATE；任务版本冲突 409，不自动重试",
    },
    auditAction: "project.member.remove",
  },
];
