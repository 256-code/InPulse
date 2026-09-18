import { ApiError } from "@generated/api";

/**
 * 草稿创建/编辑与草稿列表的统一错误文案：输入与幂等键始终保留，提示可重试。
 */
export function recordDraftErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 401) return "登录状态已失效，请重新登录。输入已保留。";
    if (error.status === 404)
      return "草稿或所属范围不存在，或你已无权访问。输入已保留。";
    if (error.status === 403) return "权限或安全校验未通过。输入已保留。";
    if (error.status === 409) return `${error.message}，输入已保留。`;
    if (error.status === 422)
      return "请检查三段必填内容、标题和所属范围。输入已保留。";
    if (error.status === 429) return "请求过于频繁，请稍后重试。输入已保留。";
  }
  return "草稿服务暂时不可用，输入已保留，可重试。";
}
