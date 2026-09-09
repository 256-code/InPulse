export type MfaReauthenticateErrorReason =
  | "invalid-session"
  | "not-admin"
  | "full-session-required"
  | "invalid-password"
  | "invalid-totp-code"
  | "csrf-rejected"
  | "reauth-conflict";

export class MfaReauthenticateError extends Error {
  constructor(
    readonly status: 401 | 403 | 409,
    readonly code: string,
    message: string,
    readonly reason: MfaReauthenticateErrorReason,
  ) {
    super(message);
    this.name = "MfaReauthenticateError";
  }
}

export function invalidSession(): MfaReauthenticateError {
  return new MfaReauthenticateError(
    401,
    "ADMIN_SESSION_REQUIRED",
    "需要有效的完整管理员 Session",
    "invalid-session",
  );
}

export function fullSessionRequired(): MfaReauthenticateError {
  return new MfaReauthenticateError(
    403,
    "ADMIN_REAUTH_SESSION_REQUIRED",
    "管理员重认证只接受 AUTHENTICATED Session",
    "full-session-required",
  );
}

export function notAdmin(): MfaReauthenticateError {
  return new MfaReauthenticateError(
    403,
    "ADMIN_REQUIRED",
    "只有系统管理员可以执行重认证",
    "not-admin",
  );
}

export function invalidPassword(): MfaReauthenticateError {
  return new MfaReauthenticateError(
    401,
    "INVALID_PASSWORD",
    "密码无效",
    "invalid-password",
  );
}

export function invalidTotpCode(): MfaReauthenticateError {
  return new MfaReauthenticateError(
    401,
    "INVALID_TOTP_CODE",
    "TOTP 验证码无效或已使用",
    "invalid-totp-code",
  );
}

export function csrfRejected(): MfaReauthenticateError {
  return new MfaReauthenticateError(
    401,
    "MFA_CSRF_REJECTED",
    "重认证请求的同步 CSRF Token 无效",
    "csrf-rejected",
  );
}

export function reauthConflict(): MfaReauthenticateError {
  return new MfaReauthenticateError(
    409,
    "REAUTH_STATE_CONFLICT",
    "重认证状态或 TOTP time-step 已变化",
    "reauth-conflict",
  );
}
