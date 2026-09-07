/**
 * ADR-023 allowlist：只有这九个一次性认证安全流程 operationId 可以登记
 * `securityFlow`，且必须且只能登记 `securityFlow`。集合必须与
 * docs/permissions.md 的“认证安全流程矩阵”精确相等。
 */
export const securityFlowOperationIds = [
  "issueCsrfToken",
  "login",
  "logout",
  "startMfaEnrollment",
  "confirmMfaEnrollment",
  "verifyMfa",
  "reauthenticateAdmin",
  "rotateMfaRecoveryCodes",
  "consumeMfaRecoveryCode",
] as const;

export type SecurityFlowOperationId = (typeof securityFlowOperationIds)[number];
