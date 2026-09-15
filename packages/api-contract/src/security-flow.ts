/**
 * ADR-023 allowlist（经 ADR-031 收缩）：只有这三个一次性认证安全流程
 * operationId 可以登记 `securityFlow`，且必须且只能登记 `securityFlow`。
 * 集合必须与 docs/permissions.md 的“认证安全流程矩阵”精确相等。
 */
export const securityFlowOperationIds = [
  "issueCsrfToken",
  "login",
  "logout",
] as const;

export type SecurityFlowOperationId = (typeof securityFlowOperationIds)[number];
