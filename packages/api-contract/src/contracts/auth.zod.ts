import { z } from "zod";

/**
 * 登录请求。`loginName` 使用与数据库唯一索引一致的规范化语义；
 * `password` 只允许在请求中出现，服务端与数据库均只保存 Argon2id 编码哈希。
 */
export const loginRequestSchema = z
  .object({
    loginName: z.string().min(1).max(100),
    password: z.string().min(1).max(1024),
  })
  .meta({ id: "LoginRequest" });

export type LoginRequest = z.infer<typeof loginRequestSchema>;

/** 非安全登录请求必须携带与预认证 Session 绑定的同步 CSRF Token。 */
export const loginHeadersSchema = z
  .object({
    "x-csrf-token": z.string().min(43).max(43),
  })
  .meta({ id: "LoginHeaders" });

export type LoginHeaders = z.infer<typeof loginHeadersSchema>;

/** Session 显式认证状态；数据库没有默认完整态。 */
export const userAuthStateSchema = z.enum([
  "AUTHENTICATED",
  "MFA_ENROLLMENT",
  "MFA_CHALLENGE",
  "RECOVERY_CHALLENGE",
]);

export type UserAuthState = z.infer<typeof userAuthStateSchema>;

/**
 * 登录成功响应。`csrfToken` 只在该次 no-store 响应出现一次；
 * `authState` 通知客户端进入完整 Session 或对应 MFA challenge。
 */
export const loginResponseSchema = z
  .object({
    csrfToken: z.string().min(43).max(43),
    authState: userAuthStateSchema,
  })
  .meta({ id: "LoginResponse" });

export type LoginResponse = z.infer<typeof loginResponseSchema>;
