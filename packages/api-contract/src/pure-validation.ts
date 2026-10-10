/**
 * AGENTS.md 第 6 节：纯校验接口（无任何持久化副作用）可以显式声明
 * idempotencyPolicy: none 与 csrfPolicy: none。allowlist 之外的 POST / PUT /
 * PATCH / DELETE 一律默认 idempotencyRequired；allowlist 成员必须同时满足
 * POST + idempotencyPolicy none + csrfPolicy none，任一不满足即契约失败。
 */
export const pureValidationOperationIds = [
  "previewProjectDocumentImport",
  "previewProjectImport",
] as const;
