export type MfaEnrollmentErrorReason =
  | "invalid-session"
  | "not-admin"
  | "enrollment-state-conflict"
  | "invalid-totp-code"
  | "csrf-rejected";

export class MfaEnrollmentError extends Error {
  constructor(
    readonly status: 401 | 403 | 409 | 429,
    readonly code: string,
    message: string,
    readonly reason: MfaEnrollmentErrorReason,
  ) {
    super(message);
    this.name = "MfaEnrollmentError";
  }
}

export function invalidSession(): MfaEnrollmentError {
  return new MfaEnrollmentError(
    401,
    "MFA_SESSION_REQUIRED",
    "需要有效的管理员 MFA 受限 Session",
    "invalid-session",
  );
}

export function notAdmin(): MfaEnrollmentError {
  return new MfaEnrollmentError(
    403,
    "MFA_ADMIN_REQUIRED",
    "只有系统管理员可以执行 MFA 注册",
    "not-admin",
  );
}

export function enrollmentConflict(): MfaEnrollmentError {
  return new MfaEnrollmentError(
    409,
    "MFA_ENROLLMENT_CONFLICT",
    "MFA 注册状态或 enrollment generation 已变化",
    "enrollment-state-conflict",
  );
}

export function invalidTotpCode(): MfaEnrollmentError {
  return new MfaEnrollmentError(
    401,
    "INVALID_TOTP_CODE",
    "TOTP 验证码无效或已使用",
    "invalid-totp-code",
  );
}

export function csrfRejected(): MfaEnrollmentError {
  return new MfaEnrollmentError(
    401,
    "MFA_CSRF_REJECTED",
    "MFA 请求的同步 CSRF Token 无效",
    "csrf-rejected",
  );
}
