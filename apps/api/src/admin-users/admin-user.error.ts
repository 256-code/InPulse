export type AdminUserErrorReason =
  | "not-found"
  | "state-conflict"
  | "version-conflict"
  | "self-mutation"
  | "last-mfa-admin";

export class AdminUserError extends Error {
  constructor(
    readonly status: 404 | 409,
    readonly code: string,
    message: string,
    readonly reason: AdminUserErrorReason,
  ) {
    super(message);
    this.name = "AdminUserError";
  }
}

export function adminUserNotFound(): AdminUserError {
  return new AdminUserError(
    404,
    "ADMIN_USER_NOT_FOUND",
    "用户不存在",
    "not-found",
  );
}

export function adminUserStateConflict(): AdminUserError {
  return new AdminUserError(
    409,
    "ADMIN_USER_STATE_CONFLICT",
    "用户当前状态不允许此操作",
    "state-conflict",
  );
}

export function adminUserVersionConflict(): AdminUserError {
  return new AdminUserError(
    409,
    "ADMIN_USER_VERSION_CONFLICT",
    "用户已在其他窗口被修改，请重新加载后再操作",
    "version-conflict",
  );
}

export function adminUserSelfMutation(): AdminUserError {
  return new AdminUserError(
    409,
    "ADMIN_USER_SELF_MUTATION_REJECTED",
    "不能对当前管理员自己执行停用、降级或强制退出",
    "self-mutation",
  );
}

export function lastMfaAdmin(): AdminUserError {
  return new AdminUserError(
    409,
    "LAST_MFA_ADMIN_REQUIRES_OFFLINE_RECOVERY",
    "不能移除最后一名可用 MFA 管理员，请先确认其他管理员的离线恢复能力",
    "last-mfa-admin",
  );
}
