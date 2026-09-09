export type MfaRecoveryErrorReason =
  | "invalid-session"
  | "recovery-state-conflict"
  | "invalid-recovery-code"
  | "not-admin"
  | "csrf-rejected";

export class MfaRecoveryError extends Error {
  constructor(
    readonly status: 401 | 403 | 409,
    readonly code: string,
    message: string,
    readonly reason: MfaRecoveryErrorReason,
  ) {
    super(message);
    this.name = "MfaRecoveryError";
  }
}

export function invalidRecoverySession(): MfaRecoveryError {
  return new MfaRecoveryError(
    401,
    "MFA_RECOVERY_SESSION_REQUIRED",
    "需要有效的管理员恢复码 Session",
    "invalid-session",
  );
}

export function notAdmin(): MfaRecoveryError {
  return new MfaRecoveryError(
    403,
    "MFA_ADMIN_REQUIRED",
    "只有系统管理员可以执行恢复码操作",
    "not-admin",
  );
}

export function recoveryConflict(): MfaRecoveryError {
  return new MfaRecoveryError(
    409,
    "MFA_RECOVERY_CONFLICT",
    "恢复码状态已变化或该验证材料已被使用",
    "recovery-state-conflict",
  );
}

export function invalidRecoveryCode(): MfaRecoveryError {
  return new MfaRecoveryError(
    401,
    "INVALID_RECOVERY_CODE",
    "恢复码无效或已被使用",
    "invalid-recovery-code",
  );
}

export function csrfRejected(): MfaRecoveryError {
  return new MfaRecoveryError(
    401,
    "MFA_CSRF_REJECTED",
    "恢复码请求的同步 CSRF Token 无效",
    "csrf-rejected",
  );
}
