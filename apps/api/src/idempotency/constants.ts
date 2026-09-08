/** NestJS DI token：版本化幂等请求摘要 keyring。 */
export const IDEMPOTENCY_FINGERPRINT_KEYRING = Symbol(
  "IDEMPOTENCY_FINGERPRINT_KEYRING",
);

/** NestJS DI token：从 Route Registry 按 operationId 解析路由策略。 */
export const IDEMPOTENCY_ROUTE_RESOLVER = Symbol("IDEMPOTENCY_ROUTE_RESOLVER");
