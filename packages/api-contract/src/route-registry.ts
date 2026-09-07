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
] satisfies readonly RouteDefinition[];

export type RegisteredRoute = (typeof routeRegistry)[number];

export function fullPath(path: string): string {
  return `${apiBasePath}${path}`;
}
