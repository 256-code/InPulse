import type { SchemaName } from "./schema-registry.js";

/** 技术设计 4.1：HTTP API 统一前缀。 */
export const apiBasePath = "/api/v1";

export type HttpMethod = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";

/** ADR-019：非安全方法默认 idempotencyRequired。 */
export const unsafeHttpMethods: readonly HttpMethod[] = [
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
];

/** AGENTS.md 第 6 节固定锁序：父级共享锁在前，业务聚合锁序在后。 */
export const canonicalLockOrder = [
  "project",
  "module",
  "feature",
  "task",
  "taskGroup",
  "changeRecord",
  "leftoverItem",
] as const;

export type LockTarget = (typeof canonicalLockOrder)[number];

export type AuthPolicy =
  "none" | "session" | "adminSessionWithReauthentication";

export type CsrfPolicy = "none" | "required";

export type IdempotencyPolicy = "none" | "idempotencyRequired" | "securityFlow";

export interface ContentTypeBinding {
  readonly contentType: string;
  readonly schemaRef: SchemaName;
}

export type BodyBinding =
  | { readonly body: { readonly contentTypes: readonly ContentTypeBinding[] } }
  | { readonly noBody: true };

export interface RouteRequest {
  readonly path: SchemaName | "none";
  readonly query: SchemaName | "none";
  readonly headers: SchemaName | "none";
  readonly body:
    | { readonly contentTypes: readonly ContentTypeBinding[] }
    | { readonly noBody: true };
}

export type ReplaySuccessEntry =
  | {
      readonly body: {
        readonly responseSchemaRef: SchemaName;
        readonly safeBodyFieldPaths: readonly string[];
      };
    }
  | { readonly noBody: true };

export interface IdempotencyReplayPolicy {
  readonly version: string;
  readonly success: Readonly<Record<string, ReplaySuccessEntry>>;
}

export type ReplayAuthorizationPolicy =
  | { readonly version: string; readonly actorOnly: true }
  | {
      readonly version: string;
      readonly resources: {
        readonly contextSchemaRef: SchemaName;
        readonly resultRefExtractor: string;
        readonly currentReadAuthorizer: string;
      };
    };

export interface SecurityFlowPolicy {
  readonly singleConsumptionOrNaturalIdempotency: string;
  readonly clientRecoveryPath: string;
}

export interface VersionPolicy {
  readonly apiVersion: string;
  readonly schemaVersion: string;
  readonly ifMatch: "required" | "none";
}

export interface ConcurrencyPolicy {
  readonly rowVersion: "required" | "none";
  readonly lockOrder: readonly LockTarget[] | "none";
  readonly retry: string;
}

/**
 * 技术设计 4.1.1：每条路由必须完整登记全部策略，不适用的策略显式写 `none`，
 * 禁止依赖隐式默认值。字段缺失由 TypeScript 与 validateRouteRegistry 双重拦截。
 */
export interface RouteDefinition {
  readonly method: HttpMethod;
  readonly path: string;
  readonly operationId: string;
  readonly summary: string;
  readonly request: RouteRequest;
  readonly responses: Readonly<Record<string, BodyBinding>>;
  readonly authPolicy: AuthPolicy;
  readonly csrfPolicy: CsrfPolicy;
  readonly idempotencyPolicy: IdempotencyPolicy;
  readonly idempotencyExceptionAdr: string | "none";
  readonly idempotencyContractVersion: string | "none";
  readonly idempotencyFingerprintVersion: string | "none";
  readonly behaviorHeaders: readonly string[] | "none";
  readonly idempotencyReplayPolicy: IdempotencyReplayPolicy | "none";
  readonly replayAuthorizationPolicy: ReplayAuthorizationPolicy | "none";
  readonly securityFlowPolicy: SecurityFlowPolicy | "none";
  readonly versionPolicy: VersionPolicy | "none";
  readonly concurrencyPolicy: ConcurrencyPolicy | "none";
  readonly auditAction: string | "none";
}

/**
 * Route Registry 是 method、path、operationId、状态码、Content-Type、鉴权、
 * CSRF、幂等与并发策略的唯一来源。只登记已实现的路由：Controller 未注册时
 * validateRouteRegistry 失败，未实现的规划路由不得提前登记。
 */
export const routeRegistry = [
  {
    method: "GET",
    path: "/health",
    operationId: "getHealth",
    summary: "存活探针，不访问数据库，不需要认证。",
    request: {
      path: "none",
      query: "none",
      headers: "none",
      body: { noBody: true },
    },
    responses: {
      "200": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "HealthResponse" },
          ],
        },
      },
    },
    authPolicy: "none",
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
    path: "/auth/csrf",
    operationId: "issueCsrfToken",
    summary:
      "匿名或已登录用户签发一次性同步 CSRF Token；匿名时创建预认证 Session。",
    request: {
      path: "none",
      query: "none",
      headers: "none",
      body: { noBody: true },
    },
    responses: {
      "200": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "CsrfIssueResponse" },
          ],
        },
      },
    },
    authPolicy: "none",
    csrfPolicy: "none",
    idempotencyPolicy: "securityFlow",
    idempotencyExceptionAdr: "ADR-023",
    idempotencyContractVersion: "none",
    idempotencyFingerprintVersion: "none",
    behaviorHeaders: "none",
    idempotencyReplayPolicy: "none",
    replayAuthorizationPolicy: "none",
    securityFlowPolicy: {
      singleConsumptionOrNaturalIdempotency:
        "每次签发新 Token 并轮换匿名预认证 Session，数据库只保存 Hash；已登录 Session 复用同一 Session 并最多保留 4 个有效 Hash",
      clientRecoveryPath: "再次调用签发端点",
    },
    versionPolicy: "none",
    concurrencyPolicy: "none",
    auditAction: "none",
  },
  {
    method: "GET",
    path: "/me",
    operationId: "getCurrentUser",
    summary: "返回当前登录用户资料；身份由服务端从 Session Cookie 解析。",
    request: {
      path: "none",
      query: "none",
      headers: "none",
      body: { noBody: true },
    },
    responses: {
      "200": {
        body: {
          contentTypes: [
            {
              contentType: "application/json",
              schemaRef: "CurrentUserResponse",
            },
          ],
        },
      },
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
  },
  {
    method: "POST",
    path: "/auth/login",
    operationId: "login",
    summary:
      "只接受匿名预认证 Session 与 X-CSRF-Token；成功后消费预认证 Session、轮换 Cookie 并签发新认证 Session 与 CSRF Token。",
    request: {
      path: "none",
      query: "none",
      headers: "LoginHeaders",
      body: {
        contentTypes: [
          { contentType: "application/json", schemaRef: "LoginRequest" },
        ],
      },
    },
    responses: {
      "200": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "LoginResponse" },
          ],
        },
      },
      "429": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
    },
    authPolicy: "none",
    csrfPolicy: "required",
    idempotencyPolicy: "securityFlow",
    idempotencyExceptionAdr: "ADR-023",
    idempotencyContractVersion: "none",
    idempotencyFingerprintVersion: "none",
    behaviorHeaders: "none",
    idempotencyReplayPolicy: "none",
    replayAuthorizationPolicy: "none",
    securityFlowPolicy: {
      singleConsumptionOrNaturalIdempotency:
        "同一匿名预认证 Session 与其 CSRF Hash 只能成功登录一次；成功时在同一事务条件消费预认证 Session，并创建新的认证 Session 与 CSRF Hash",
      clientRecoveryPath:
        "若已有认证/受限 Session 先登出或清 Cookie，再重新调用 CSRF 签发端点并登录",
    },
    versionPolicy: "none",
    concurrencyPolicy: "none",
    auditAction: "none",
  },
  {
    method: "POST",
    path: "/auth/logout",
    operationId: "logout",
    summary:
      "有效 Session 验证同源与当前 CSRF Token 后在事务内撤销；无效或已撤销 Session 仅清 Cookie，统一返回 204。",
    request: {
      path: "none",
      query: "none",
      headers: "LogoutHeaders",
      body: { noBody: true },
    },
    responses: {
      "204": { noBody: true },
    },
    authPolicy: "none",
    csrfPolicy: "required",
    idempotencyPolicy: "securityFlow",
    idempotencyExceptionAdr: "ADR-023",
    idempotencyContractVersion: "none",
    idempotencyFingerprintVersion: "none",
    behaviorHeaders: "none",
    idempotencyReplayPolicy: "none",
    replayAuthorizationPolicy: "none",
    securityFlowPolicy: {
      singleConsumptionOrNaturalIdempotency:
        "有效 Session 只在同一事务验证 CSRF 后条件撤销；无效或已撤销 Session 的同源重试仅清 Cookie，不执行状态写",
      clientRecoveryPath:
        "直接重试同一登出请求；有效 Session 需先调用 CSRF 签发端点取得当前 Token",
    },
    versionPolicy: "none",
    concurrencyPolicy: "none",
    auditAction: "none",
  },
  {
    method: "GET",
    path: "/search",
    operationId: "getSearch",
    summary:
      "按服务端 AuthorizedProjectScope 搜索当前用户可访问项目中的投影实体；普通输入使用 PGroonga 转义查询，禁止客户端传入授权范围；cursor 为服务端签名、校验并带过期时间的不透明字符串；includeVoid=true 仅供系统管理员显式开启 VOID 可见，普通调用不影响范围。",
    request: {
      path: "none",
      query: "SearchQueryRequest",
      headers: "none",
      body: { noBody: true },
    },
    responses: {
      "200": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "SearchPage" },
          ],
        },
      },
      "422": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "401": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "500": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
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
  },
  {
    method: "GET",
    path: "/projects/{projectId}/activity",
    operationId: "getProjectActivity",
    summary:
      "读取当前用户可访问项目的脱敏动态时间线；SQL 前强制服务端 AuthorizedProjectScope，普通成员只返回 MEMBER，系统管理员可显式包含 ADMIN_ONLY。",
    request: {
      path: "ActivityPath",
      query: "ActivityQueryRequest",
      headers: "none",
      body: { noBody: true },
    },
    responses: {
      "200": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ActivityPage" },
          ],
        },
      },
      "401": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "404": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "422": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "500": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
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
  },
  {
    method: "GET",
    path: "/notifications",
    operationId: "getNotifications",
    summary:
      "当前用户自己的站内通知列表；SQL 强制 recipient_id=当前用户，cursor 为服务端签名、校验并带过期时间的不透明字符串。",
    request: {
      path: "none",
      query: "NotificationQueryRequest",
      headers: "none",
      body: { noBody: true },
    },
    responses: {
      "200": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "NotificationPage" },
          ],
        },
      },
      "401": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "422": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "500": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
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
  },
  {
    method: "GET",
    path: "/notifications/unread-count",
    operationId: "getNotificationUnreadCount",
    summary: "返回当前登录用户的未读通知数量。",
    request: {
      path: "none",
      query: "none",
      headers: "none",
      body: { noBody: true },
    },
    responses: {
      "200": {
        body: {
          contentTypes: [
            {
              contentType: "application/json",
              schemaRef: "NotificationUnreadCountResponse",
            },
          ],
        },
      },
      "401": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "500": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
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
  },
  {
    method: "POST",
    path: "/notifications/{notificationId}/read",
    operationId: "readNotification",
    summary:
      "把当前用户的一条通知标记为已读；不存在或非本人统一返回 404，重复执行自然幂等。",
    request: {
      path: "NotificationPath",
      query: "none",
      headers: "none",
      body: { noBody: true },
    },
    responses: {
      "204": { noBody: true },
      "400": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "401": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "403": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "404": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "409": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "500": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
    },
    authPolicy: "session",
    csrfPolicy: "required",
    idempotencyPolicy: "idempotencyRequired",
    idempotencyExceptionAdr: "none",
    idempotencyContractVersion: "1.0.0",
    idempotencyFingerprintVersion: "1.0.0",
    behaviorHeaders: [],
    idempotencyReplayPolicy: {
      version: "1.0.0",
      success: { "204": { noBody: true } },
    },
    replayAuthorizationPolicy: {
      version: "1.0.0",
      resources: {
        contextSchemaRef: "NotificationReplayContext",
        resultRefExtractor: "notificationId",
        currentReadAuthorizer: "notificationOwnerAuthorizer",
      },
    },
    securityFlowPolicy: "none",
    versionPolicy: "none",
    concurrencyPolicy: "none",
    auditAction: "none",
  },
  {
    method: "POST",
    path: "/notifications/{notificationId}/unread",
    operationId: "unreadNotification",
    summary:
      "把当前用户的一条通知标记为未读；不存在或非本人统一返回 404，重复执行自然幂等。",
    request: {
      path: "NotificationPath",
      query: "none",
      headers: "none",
      body: { noBody: true },
    },
    responses: {
      "204": { noBody: true },
      "400": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "401": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "403": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "404": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "409": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "500": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
    },
    authPolicy: "session",
    csrfPolicy: "required",
    idempotencyPolicy: "idempotencyRequired",
    idempotencyExceptionAdr: "none",
    idempotencyContractVersion: "1.0.0",
    idempotencyFingerprintVersion: "1.0.0",
    behaviorHeaders: [],
    idempotencyReplayPolicy: {
      version: "1.0.0",
      success: { "204": { noBody: true } },
    },
    replayAuthorizationPolicy: {
      version: "1.0.0",
      resources: {
        contextSchemaRef: "NotificationReplayContext",
        resultRefExtractor: "notificationId",
        currentReadAuthorizer: "notificationOwnerAuthorizer",
      },
    },
    securityFlowPolicy: "none",
    versionPolicy: "none",
    concurrencyPolicy: "none",
    auditAction: "none",
  },
  {
    method: "POST",
    path: "/notifications/read-all",
    operationId: "readAllNotifications",
    summary: "把当前用户的全部未读通知标记为已读；响应不暴露其他用户资源。",
    request: {
      path: "none",
      query: "none",
      headers: "none",
      body: { noBody: true },
    },
    responses: {
      "204": { noBody: true },
      "400": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "401": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "403": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "409": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "500": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
    },
    authPolicy: "session",
    csrfPolicy: "required",
    idempotencyPolicy: "idempotencyRequired",
    idempotencyExceptionAdr: "none",
    idempotencyContractVersion: "1.0.0",
    idempotencyFingerprintVersion: "1.0.0",
    behaviorHeaders: [],
    idempotencyReplayPolicy: {
      version: "1.0.0",
      success: { "204": { noBody: true } },
    },
    replayAuthorizationPolicy: { version: "1.0.0", actorOnly: true },
    securityFlowPolicy: "none",
    versionPolicy: "none",
    concurrencyPolicy: "none",
    auditAction: "none",
  },
] satisfies readonly RouteDefinition[];

export type RegisteredRoute = (typeof routeRegistry)[number];

export function fullPath(path: string): string {
  return `${apiBasePath}${path}`;
}
