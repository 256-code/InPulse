import { ApiError } from "@generated/api";

export function isUnauthenticated(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

export type MfaErrorContext =
  "enrollment" | "challenge" | "recovery" | "reauth";

export function isMfaSessionInvalid(error: unknown): boolean {
  if (!(error instanceof ApiError)) {
    return false;
  }
  return [
    "MFA_SESSION_REQUIRED",
    "MFA_CHALLENGE_SESSION_REQUIRED",
    "MFA_RECOVERY_SESSION_REQUIRED",
    "ADMIN_SESSION_REQUIRED",
  ].includes(error.code);
}

export function describeMfaError(
  error: unknown,
  context: MfaErrorContext,
): string {
  if (error instanceof ApiError) {
    if (error.status === 429) {
      return "MFA 验证失败次数过多，请稍后再试。";
    }
    switch (error.code) {
      case "INVALID_TOTP_CODE":
        return "验证码无效或已使用，请输入当前 6 位验证码。";
      case "INVALID_RECOVERY_CODE":
        return "恢复码无效或已被使用。";
      case "INVALID_PASSWORD":
        return "管理员密码不正确。";
      case "MFA_ENROLLMENT_CONFLICT":
        return "注册状态已变化，请重新获取验证器信息。";
      case "MFA_VERIFY_CONFLICT":
        return "验证状态已变化或验证码已使用，请重新验证。";
      case "MFA_RECOVERY_CONFLICT":
        return "恢复码状态已变化，请重新登录。";
      case "REAUTH_STATE_CONFLICT":
        return "重认证状态或验证码时间窗已变化，请重试。";
      case "MFA_CSRF_REJECTED":
      case "CSRF_ORIGIN_REJECTED":
      case "CSRF_TOKEN_INVALID":
        return "安全令牌已更新，请刷新页面后重试。";
      case "MFA_ADMIN_REQUIRED":
      case "ADMIN_REQUIRED":
      case "ADMIN_REAUTH_SESSION_REQUIRED":
        return "此操作需要有效的系统管理员会话。";
      case "MFA_SESSION_REQUIRED":
      case "MFA_CHALLENGE_SESSION_REQUIRED":
      case "MFA_RECOVERY_SESSION_REQUIRED":
      case "ADMIN_SESSION_REQUIRED":
        return "安全登录状态已失效，请刷新页面后重新登录。";
    }
    if (error.status === 401) {
      return context === "reauth"
        ? "密码、验证码或当前登录状态无效，请重试。"
        : "验证信息或安全状态无效，请重试。";
    }
    if (error.status === 403) {
      return "安全校验未通过，请刷新页面后重试。";
    }
    if (error.status === 409) {
      return "当前安全流程状态已变化，请重新登录后重试。";
    }
    if (error.status === 422) {
      return "提交格式不正确，请检查后重试。";
    }
  }
  return "安全验证暂时不可用，请稍后重试。";
}

export function describeLoginError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.status) {
      case 401:
        return "登录名或密码不正确，或登录状态已失效，请刷新页面后重试。";
      case 403:
        return "安全校验未通过，请刷新页面后重试。";
      case 409:
        return "当前已有有效登录状态，请先退出后再登录。";
      case 422:
        return "登录名或密码格式不正确。";
      case 429:
        return "登录请求过于频繁，请稍后重试。";
      default:
        return "服务器暂时无法完成登录，请稍后重试。";
    }
  }
  return "登录暂时不可用，请稍后重试。";
}
