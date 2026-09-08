import { ApiError } from "@generated/api";

export function isUnauthenticated(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
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
