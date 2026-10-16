/**
 * ADR-023 allowlist（经 ADR-031 收缩、ADR-032 扩展、ADR-069 与 ADR-077 各扩展一条，共七条）：只有这七个一次性
 * 认证安全流程 operationId 可以登记 `securityFlow`，且必须且只能登记 `securityFlow`。
 * 集合必须与 docs/permissions.md 的“认证安全流程矩阵”精确相等。
 */
export const securityFlowOperationIds = [
  "issueCsrfToken",
  "login",
  "logout",
  "startSsoLogin",
  "completeSsoLogin",
  "createWecomBindingCode",
  "createProjectWecomGroupCode",
] as const;

export type SecurityFlowOperationId = (typeof securityFlowOperationIds)[number];
