export type MfaVerifyErrorReason =
  | "invalid-session"
  | "not-admin"
  | "verify-conflict"
  | "invalid-totp-code"
  | "csrf-rejected";

export class MfaVerifyError extends Error {
  constructor(
    readonly status: 401 | 403 | 409 | 429,
    readonly code: string,
    message: string,
    readonly reason: MfaVerifyErrorReason,
  ) {
    super(message);
    this.name = "MfaVerifyError";
  }
}

export function invalidMfaSession(): MfaVerifyError {
  return new MfaVerifyError(
    401,
    "MFA_CHALLENGE_SESSION_REQUIRED",
    "需要有效的管理员 MFA 验证 Session",
    "invalid-session",
  );
}

export function notAdmin(): MfaVerifyError {
  return new MfaVerifyError(
    403,
    "MFA_ADMIN_REQUIRED",
    "只有系统管理员可以完成 MFA 验证",
    "not-admin",
  );
}

export function verifyConflict(): MfaVerifyError {
  return new MfaVerifyError(
    409,
    "MFA_VERIFY_CONFLICT",
    "MFA 验证状态已变化或验证码已使用",
    "verify-conflict",
  );
}

export function invalidTotpCode(): MfaVerifyError {
  return new MfaVerifyError(
    401,
    "INVALID_TOTP_CODE",
    "TOTP 验证码无效或已使用",
    "invalid-totp-code",
  );
}

export function csrfRejected(): MfaVerifyError {
  return new MfaVerifyError(
    401,
    "MFA_CSRF_REJECTED",
    "MFA 验证请求的同步 CSRF Token 无效",
    "csrf-rejected",
  );
}
