import { z } from "zod";

/**
 * CSRF 签发响应。明文字符串只允许出现在本次 `no-store` 响应中，
 * 服务端和数据库只保存 HMAC-SHA-256 哈希。
 */
export const csrfIssueResponseSchema = z
  .object({
    csrfToken: z.string().min(43).max(43),
  })
  .meta({ id: "CsrfIssueResponse" });

export type CsrfIssueResponse = z.infer<typeof csrfIssueResponseSchema>;
