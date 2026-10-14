import type { RouteDefinition } from "./route-definition.js";
import type { SchemaName } from "./schema-registry.js";

const json = (schemaRef: SchemaName): RouteDefinition["responses"][string] => ({
  body: { contentTypes: [{ contentType: "application/json", schemaRef }] },
});

const error = json("ErrorResponse");

/**
 * ADR-069：企业微信机器人绑定（用户自助）。
 * GET 读取当前绑定状态；POST codes 签发一次性绑定码（securityFlow，ADR-023
 * allowlist 扩展）；DELETE 解除绑定（状态流转，不物理删除）。
 */
export const wecomBindingRoutes: readonly RouteDefinition[] = [
  {
    method: "GET",
    path: "/me/wecom-binding",
    operationId: "getWecomBinding",
    summary:
      "当前登录用户的企业微信机器人绑定状态；未绑定且无待用码为 UNBOUND，有待用码为 PENDING，已绑定为 BOUND；身份由服务端从 Session Cookie 解析，不接受客户端指定用户。",
    request: {
      path: "none",
      query: "none",
      headers: "none",
      body: { noBody: true },
    },
    responses: {
      "200": json("WecomBindingStatus"),
      "401": error,
      "500": error,
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
    path: "/me/wecom-binding/codes",
    operationId: "createWecomBindingCode",
    summary:
      "为当前登录用户签发一次性企微绑定码（10 分钟有效；明文只返回一次，服务端只存 SHA-256 Hash）。ADR-069 将本路由加入 ADR-023 allowlist：签发一次性安全材料，重复请求签发新码并立即作废旧码、不进入通用幂等记录；CSRF 与同源校验必填。",
    request: {
      path: "none",
      query: "none",
      headers: "WecomBindingMutationHeaders",
      body: { noBody: true },
    },
    responses: {
      "201": json("WecomBindingCode"),
      "400": error,
      "401": error,
      "403": error,
      "500": error,
    },
    authPolicy: "session",
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
        "每次调用在同一事务内覆盖签发新码并立即作废旧码；码只存 SHA-256 Hash，10 分钟有效、一次性消费（兑换函数按 Hash 行锁 + 条件消费 + 唯一索引兜底），不存在重复签发或重放歧义；码被消费前不产生任何绑定",
      clientRecoveryPath:
        "重新调用本端点生成新码；无效、已过期或已被使用的码一律拒绝绑定，由用户在页面重新生成",
    },
    versionPolicy: "none",
    concurrencyPolicy: "none",
    auditAction: "none",
  },
  {
    method: "DELETE",
    path: "/me/wecom-binding",
    operationId: "deleteWecomBinding",
    summary:
      "解除当前用户的企业微信绑定：作废待用绑定码并撤销 ACTIVE 绑定（状态流转 REVOKED，不物理删除，重绑时更新原行）；CSRF 与 Idempotency-Key 必填，重复执行自然幂等。",
    request: {
      path: "none",
      query: "none",
      headers: "WecomBindingMutationHeaders",
      body: { noBody: true },
    },
    responses: {
      "204": { noBody: true },
      "400": error,
      "401": error,
      "403": error,
      "409": error,
      "500": error,
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
      actorOnly: true,
    },
    securityFlowPolicy: "none",
    versionPolicy: "none",
    concurrencyPolicy: "none",
    auditAction: "none",
  },
];
