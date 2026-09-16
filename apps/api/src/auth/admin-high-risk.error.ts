export type AdminHighRiskErrorReason =
  "invalid-session" | "not-admin" | "csrf-rejected";

export class AdminHighRiskError extends Error {
  constructor(
    readonly status: 401 | 403,
    readonly code: string,
    message: string,
    readonly reason: AdminHighRiskErrorReason,
  ) {
    super(message);
    this.name = "AdminHighRiskError";
  }
}

export function invalidAdminSession(): AdminHighRiskError {
  return new AdminHighRiskError(
    401,
    "ADMIN_SESSION_REQUIRED",
    "需要有效的完整管理员 Session",
    "invalid-session",
  );
}

export function notAdmin(): AdminHighRiskError {
  return new AdminHighRiskError(
    403,
    "ADMIN_REQUIRED",
    "只有系统管理员可以执行该高风险操作",
    "not-admin",
  );
}

export function csrfRejected(): AdminHighRiskError {
  return new AdminHighRiskError(
    401,
    "ADMIN_CSRF_REJECTED",
    "高风险操作的同步 CSRF Token 无效",
    "csrf-rejected",
  );
}
