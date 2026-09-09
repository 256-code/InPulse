import { z } from "zod";

/**
 * 登录请求。`loginName` 使用与数据库唯一索引一致的规范化语义；
 * `password` 只允许在请求中出现，服务端与数据库均只保存 Argon2id 编码哈希。
 */
export const loginRequestSchema = z
  .object({
    loginName: z.string().min(1).max(100),
    password: z.string().min(1).max(1024),
    challengeMode: z.enum(["totp", "recovery"]).default("totp"),
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
    /**
     * 管理员处于 `MFA_ENROLLMENT` 时返回当前用户级 enrollment generation；
     * 客户端必须先登录读取该值，再调用 start/confirm。
     */
    enrollmentGeneration: z.number().int().min(0).max(1_000_000).optional(),
  })
  .meta({ id: "LoginResponse" });

export type LoginResponse = z.infer<typeof loginResponseSchema>;

/** 管理员 MFA 注册与确认需要当前 Session 绑定的同步 CSRF Token。 */
export const mfaEnrollmentHeadersSchema = z
  .object({
    "x-csrf-token": z.string().min(43).max(43),
  })
  .meta({ id: "MfaEnrollmentHeaders" });

export type MfaEnrollmentHeaders = z.infer<typeof mfaEnrollmentHeadersSchema>;

/**
 * 开始 MFA 注册。首次注册传 0；若前一次 response 丢失，先重新登录读取当前
 * generation，再以该值重新开始，使旧 pending Secret 立即失效。
 */
export const startMfaEnrollmentRequestSchema = z
  .object({
    expectedEnrollmentGeneration: z.number().int().min(0).max(1_000_000),
  })
  .meta({ id: "StartMfaEnrollmentRequest" });

export type StartMfaEnrollmentRequest = z.infer<
  typeof startMfaEnrollmentRequestSchema
>;

/** 注册开始响应只在 no-store 响应中返回一次 Secret 与 otpauth URI。 */
export const startMfaEnrollmentResponseSchema = z
  .object({
    enrollmentGeneration: z.number().int().positive(),
    secret: z
      .string()
      .regex(/^[A-Z2-7]{32}$/)
      .max(64),
    otpauthUri: z.string().startsWith("otpauth://totp/").max(2048),
  })
  .meta({ id: "StartMfaEnrollmentResponse" });

export type StartMfaEnrollmentResponse = z.infer<
  typeof startMfaEnrollmentResponseSchema
>;

/** 确认注册：必须携带与响应中相同的 generation 和当前 6 位 TOTP 验证码。 */
export const confirmMfaEnrollmentRequestSchema = z
  .object({
    expectedEnrollmentGeneration: z.number().int().min(0).max(1_000_000),
    code: z.string().regex(/^\d{6}$/),
  })
  .meta({ id: "ConfirmMfaEnrollmentRequest" });

export type ConfirmMfaEnrollmentRequest = z.infer<
  typeof confirmMfaEnrollmentRequestSchema
>;

/** 注册确认只展示一次恢复码，同时返回新完整 Session 对应的 CSRF Token。 */
export const confirmMfaEnrollmentResponseSchema = z
  .object({
    csrfToken: z.string().min(43).max(43),
    authState: z.literal("AUTHENTICATED"),
    recoveryCodes: z.array(z.string().regex(/^[A-HJ-NP-Z2-9]{20}$/)).length(10),
  })
  .meta({ id: "ConfirmMfaEnrollmentResponse" });

export type ConfirmMfaEnrollmentResponse = z.infer<
  typeof confirmMfaEnrollmentResponseSchema
>;

/** 管理员 MFA 验证需要当前 `MFA_CHALLENGE` Session 绑定的同步 CSRF Token。 */
export const verifyMfaHeadersSchema = z
  .object({
    "x-csrf-token": z.string().min(43).max(43),
  })
  .meta({ id: "VerifyMfaHeaders" });

export type VerifyMfaHeaders = z.infer<typeof verifyMfaHeadersSchema>;

/** 管理员 TOTP 验证请求，只接受当前 6 位验证码。 */
export const verifyMfaRequestSchema = z
  .object({
    code: z.string().regex(/^\d{6}$/),
  })
  .meta({ id: "VerifyMfaRequest" });

export type VerifyMfaRequest = z.infer<typeof verifyMfaRequestSchema>;

/** MFA 验证成功响应；Session 升级为完整态并签发新 CSRF Token。 */
export const verifyMfaResponseSchema = z
  .object({
    csrfToken: z.string().min(43).max(43),
    authState: z.literal("AUTHENTICATED"),
  })
  .meta({ id: "VerifyMfaResponse" });

export type VerifyMfaResponse = z.infer<typeof verifyMfaResponseSchema>;

/** 管理员重认证需要当前完整 Session 绑定的同步 CSRF Token。 */
export const reauthenticateAdminHeadersSchema = z
  .object({
    "x-csrf-token": z.string().min(43).max(43),
  })
  .meta({ id: "ReauthenticateAdminHeaders" });

export type ReauthenticateAdminHeaders = z.infer<
  typeof reauthenticateAdminHeadersSchema
>;

/** 管理员重认证请求，需要密码与当前未使用的 6 位 TOTP 验证码。 */
export const reauthenticateAdminRequestSchema = z
  .object({
    password: z.string().min(1).max(1024),
    code: z.string().regex(/^\d{6}$/),
  })
  .meta({ id: "ReauthenticateAdminRequest" });

export type ReauthenticateAdminRequest = z.infer<
  typeof reauthenticateAdminRequestSchema
>;

/** 恢复码轮换需要当前完整 Session 绑定的同步 CSRF Token。 */
export const rotateMfaRecoveryCodesHeadersSchema = z
  .object({
    "x-csrf-token": z.string().min(43).max(43),
  })
  .meta({ id: "RotateMfaRecoveryCodesHeaders" });

export type RotateMfaRecoveryCodesHeaders = z.infer<
  typeof rotateMfaRecoveryCodesHeadersSchema
>;

/** 恢复码轮换成功响应；新码只在该次 no-store 响应出现一次。 */
export const rotateMfaRecoveryCodesResponseSchema = z
  .object({
    recoveryCodes: z.array(z.string().regex(/^[A-HJ-NP-Z2-9]{20}$/)).length(10),
  })
  .strict()
  .meta({ id: "RotateMfaRecoveryCodesResponse" });

export type RotateMfaRecoveryCodesResponse = z.infer<
  typeof rotateMfaRecoveryCodesResponseSchema
>;

/** 恢复码消费需要当前 `RECOVERY_CHALLENGE` Session 绑定的同步 CSRF Token。 */
export const consumeMfaRecoveryCodeHeadersSchema = z
  .object({
    "x-csrf-token": z.string().min(43).max(43),
  })
  .meta({ id: "ConsumeMfaRecoveryCodeHeaders" });

export type ConsumeMfaRecoveryCodeHeaders = z.infer<
  typeof consumeMfaRecoveryCodeHeadersSchema
>;

/** 恢复码消费请求，只接受当前批次未使用的 20 字符恢复码。 */
export const consumeMfaRecoveryCodeRequestSchema = z
  .object({
    code: z.string().regex(/^[A-HJ-NP-Z2-9]{20}$/),
  })
  .strict()
  .meta({ id: "ConsumeMfaRecoveryCodeRequest" });

export type ConsumeMfaRecoveryCodeRequest = z.infer<
  typeof consumeMfaRecoveryCodeRequestSchema
>;

/** 恢复码消费成功响应；Session 升级为完整态并返回新 CSRF Token。 */
export const consumeMfaRecoveryCodeResponseSchema = z
  .object({
    csrfToken: z.string().min(43).max(43),
    authState: z.literal("AUTHENTICATED"),
  })
  .strict()
  .meta({ id: "ConsumeMfaRecoveryCodeResponse" });

export type ConsumeMfaRecoveryCodeResponse = z.infer<
  typeof consumeMfaRecoveryCodeResponseSchema
>;

/** 管理员 MFA 重置需要当前完整管理员 Session 的同步 CSRF Token。 */
export const resetAdminMfaHeadersSchema = z
  .object({
    "x-csrf-token": z.string().min(43).max(43),
  })
  .meta({ id: "ResetAdminMfaHeaders" });

export type ResetAdminMfaHeaders = z.infer<typeof resetAdminMfaHeadersSchema>;

/**
 * 管理员 MFA 重置请求。目标用户必须为系统管理员且不能是当前执行者；
 * `reason` 必填并写入审计，不保存任何 MFA Secret 或恢复码。
 */
export const resetAdminMfaRequestSchema = z
  .object({
    userId: z.number().int().positive(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict()
  .meta({ id: "ResetAdminMfaRequest" });

export type ResetAdminMfaRequest = z.infer<typeof resetAdminMfaRequestSchema>;

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
