import { z } from "zod";

/**
 * 登录请求。`loginName` 使用与数据库唯一索引一致的规范化语义；
 * `password` 只允许在请求中出现，服务端与数据库均只保存 Argon2id 编码哈希。
 * ADR-031 之后不再有 TOTP 与恢复码步骤，登录只保留口令因素。
 */
export const loginRequestSchema = z
  .object({
    loginName: z.string().min(1).max(100),
    password: z.string().min(1).max(1024),
  })
  .strict()
  .meta({ id: "LoginRequest" });

export type LoginRequest = z.infer<typeof loginRequestSchema>;

/** 非安全登录请求必须携带与预认证 Session 绑定的同步 CSRF Token。 */
export const loginHeadersSchema = z
  .object({
    "x-csrf-token": z.string().min(43).max(43),
  })
  .meta({ id: "LoginHeaders" });

export type LoginHeaders = z.infer<typeof loginHeadersSchema>;

/**
 * 登出请求头。有效 Session 必须携带与其绑定的同步 CSRF Token；
 * Session 已失效或已撤销的同源重试允许省略该头。
 */
export const logoutHeadersSchema = z
  .object({
    "x-csrf-token": z.string().min(43).max(43).optional(),
  })
  .meta({ id: "LogoutHeaders" });

export type LogoutHeaders = z.infer<typeof logoutHeadersSchema>;

/**
 * Session 显式认证状态。ADR-031 移除 TOTP 后只存在完整认证态；
 * 数据库 `auth_state` 约束中的历史 MFA 取值保留待 contract 迁移清理。
 */
export const userAuthStateSchema = z.literal("AUTHENTICATED");

export type UserAuthState = z.infer<typeof userAuthStateSchema>;

/**
 * 登录成功响应。`csrfToken` 只在该次 no-store 响应出现一次；
 * `authState` 恒为完整认证态。
 */
export const loginResponseSchema = z
  .object({
    csrfToken: z.string().min(43).max(43),
    authState: userAuthStateSchema,
  })
  .meta({ id: "LoginResponse" });

export type LoginResponse = z.infer<typeof loginResponseSchema>;

/**
 * 当前登录用户资料。`id` 来自服务端解析出的 Session，不接受客户端输入；
 * 与 `app.users` 的可空字段保持一致，避免把数据库内部字段暴露给客户端。
 */
export const currentUserResponseSchema = z
  .object({
    id: z.number().int().positive(),
    loginName: z.string().min(1).max(100),
    name: z.string().min(1).max(200),
    email: z.string().min(3).max(320).nullable(),
    avatarUrl: z.string().min(1).max(2048).nullable(),
    isAdmin: z.boolean(),
    status: z.enum(["ACTIVE", "DISABLED"]),
  })
  .meta({ id: "CurrentUserResponse" });

export type CurrentUserResponse = z.infer<typeof currentUserResponseSchema>;
