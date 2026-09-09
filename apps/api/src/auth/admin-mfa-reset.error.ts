export type AdminMfaResetErrorReason =
  | "invalid-session"
  | "not-admin"
  | "target-not-found"
  | "target-not-active"
  | "self-reset"
  | "last-admin"
  | "factor-conflict";

export class AdminMfaResetError extends Error {
  constructor(
    readonly status: 401 | 403 | 404 | 409,
    readonly code: string,
    message: string,
    readonly reason: AdminMfaResetErrorReason,
  ) {
    super(message);
    this.name = "AdminMfaResetError";
  }
}

export function invalidAdminSession(): AdminMfaResetError {
  return new AdminMfaResetError(
    401,
    "ADMIN_SESSION_REQUIRED",
    "需要有效的完整管理员 Session",
    "invalid-session",
  );
}

export function targetNotFound(): AdminMfaResetError {
  return new AdminMfaResetError(
    404,
    "TARGET_ADMIN_NOT_FOUND",
    "目标管理员不存在",
    "target-not-found",
  );
}

export function targetNotActive(): AdminMfaResetError {
  return new AdminMfaResetError(
    403,
    "TARGET_ADMIN_NOT_ACTIVE",
    "目标管理员未处于启用状态",
    "target-not-active",
  );
}

export function selfReset(): AdminMfaResetError {
  return new AdminMfaResetError(
    409,
    "ADMIN_MFA_SELF_RESET_REJECTED",
    "不能在线重置自己的 MFA，必须由另一名管理员执行",
    "self-reset",
  );
}

export function lastAdmin(): AdminMfaResetError {
  return new AdminMfaResetError(
    409,
    "LAST_MFA_ADMIN_REQUIRES_OFFLINE_RECOVERY",
    "仅剩一名可用 MFA 管理员时禁止在线重置，请走双人离线恢复 Runbook",
    "last-admin",
  );
}

export function factorConflict(): AdminMfaResetError {
  return new AdminMfaResetError(
    409,
    "ADMIN_MFA_RESET_CONFLICT",
    "目标 MFA 状态已变化，无法完成重置",
    "factor-conflict",
  );
}

export function notAdmin(): AdminMfaResetError {
  return new AdminMfaResetError(
    403,
    "ADMIN_REQUIRED",
    "只有系统管理员可以执行 MFA 重置",
    "not-admin",
  );
}
