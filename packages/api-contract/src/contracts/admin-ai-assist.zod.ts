import { z } from "zod";

const id = z.number().int().positive().max(2147483647);

/**
 * ADR-068 AI 辅助转换管理员配置（GET 响应）。
 * 永不返回密钥明文或密文：只返回尾 4 位提示与是否已配置。
 */
export const aiAssistSettingsSourceSchema = z.enum([
  "DATABASE",
  "ENVIRONMENT",
  "NONE",
]);

/** 当前为何不可用（fail closed 分类；ready 为 true 时恒为 null）。 */
export const aiAssistSettingsDisabledReasonSchema = z.enum([
  "KILL_SWITCH",
  "NOT_ENABLED",
  "CONFIG_INVALID",
  "ENCRYPTION_KEY_UNAVAILABLE",
]);

export const aiAssistSettingsItemSchema = z
  .object({
    enabled: z.boolean().describe("配置记录的启用开关（最终是否可用还要看 ready）"),
    source: aiAssistSettingsSourceSchema.describe(
      "DATABASE 为管理员在线配置；ENVIRONMENT 为无数据库行时的遗留环境变量模式；NONE 为未配置",
    ),
    ready: z.boolean().describe("当前实际是否可发起 AI 辅助转换"),
    disabledReason: aiAssistSettingsDisabledReasonSchema.nullable(),
    endpoint: z.string().min(1).max(2048).nullable(),
    model: z.string().min(1).max(200).nullable(),
    timeoutMs: z.number().int().min(1000).max(600000),
    maxTokens: z.number().int().min(1).max(200000),
    keyConfigured: z.boolean(),
    keyHint: z.string().min(1).max(16).nullable().describe("密钥尾 4 位提示；不回显密钥本身"),
    rowVersion: z.number().int().min(1).max(2147483647).nullable(),
    updatedAt: z.iso.datetime().nullable(),
  })
  .strict()
  .meta({ id: "AiAssistSettings" });

/** 保存配置：整体替换语义；apiKey 缺省或 null 表示保持已存密钥不变。 */
export const aiAssistSettingsUpdateRequestSchema = z
  .object({
    enabled: z.boolean(),
    endpoint: z.string().trim().min(1).max(2048),
    model: z.string().trim().min(1).max(200),
    timeoutMs: z.number().int().min(1000).max(600000),
    maxTokens: z.number().int().min(1).max(200000),
    apiKey: z.string().trim().min(8).max(1024).nullable().optional(),
  })
  .strict()
  .meta({ id: "AiAssistSettingsUpdateRequest" });

/** 测试连接结果：ok 为 true 时 reason 为 null；否则为固定失败分类。 */
export const aiAssistSettingsTestReasonSchema = z.enum([
  "KILL_SWITCH",
  "NOT_ENABLED",
  "CONFIG_INVALID",
  "ENCRYPTION_KEY_UNAVAILABLE",
  "AUTH",
  "RATE_LIMITED",
  "TIMEOUT",
  "NETWORK",
  "CONTEXT_LIMIT",
  "INVALID_RESPONSE",
]);

export const aiAssistSettingsTestResponseSchema = z
  .object({
    ok: z.boolean(),
    reason: aiAssistSettingsTestReasonSchema.nullable(),
    model: z.string().min(1).max(200).nullable(),
  })
  .strict()
  .meta({ id: "AiAssistSettingsTestResponse" });

/** 管理员配置写请求头；CSRF 同步 Token 必填。 */
export const aiAssistSettingsMutationHeadersSchema = z
  .object({ "x-csrf-token": z.string().length(43) })
  .strict()
  .meta({ id: "AiAssistSettingsMutationHeaders" });

/** 幂等重放授权上下文：单行配置 + 原始管理员。 */
export const aiAssistSettingsReplayContextSchema = z
  .object({ actorUserId: id, settingsRowId: id })
  .strict()
  .meta({ id: "AiAssistSettingsReplayContext" });

export type AiAssistSettingsSource = z.infer<typeof aiAssistSettingsSourceSchema>;
export type AiAssistSettingsDisabledReason = z.infer<
  typeof aiAssistSettingsDisabledReasonSchema
>;
export type AiAssistSettingsItem = z.infer<typeof aiAssistSettingsItemSchema>;
export type AiAssistSettingsUpdateRequest = z.infer<
  typeof aiAssistSettingsUpdateRequestSchema
>;
export type AiAssistSettingsTestReason = z.infer<
  typeof aiAssistSettingsTestReasonSchema
>;
export type AiAssistSettingsTestResponse = z.infer<
  typeof aiAssistSettingsTestResponseSchema
>;
export type AiAssistSettingsReplayContext = z.infer<
  typeof aiAssistSettingsReplayContextSchema
>;

export const adminAiAssistSchemas = {
  AiAssistSettings: {
    schema: aiAssistSettingsItemSchema,
    summary: "AI 辅助转换管理员配置视图；只含密钥尾号，不回显密钥",
    sensitiveFieldPaths: [],
  },
  AiAssistSettingsUpdateRequest: {
    schema: aiAssistSettingsUpdateRequestSchema,
    summary: "AI 辅助转换配置保存请求；apiKey 只接收一次、加密落库",
    sensitiveFieldPaths: ["apiKey"],
  },
  AiAssistSettingsTestResponse: {
    schema: aiAssistSettingsTestResponseSchema,
    summary: "AI 辅助转换测试连接结果",
    sensitiveFieldPaths: [],
  },
  AiAssistSettingsMutationHeaders: {
    schema: aiAssistSettingsMutationHeadersSchema,
    summary: "AI 辅助转换配置写请求头，要求同步 CSRF Token",
    sensitiveFieldPaths: ["x-csrf-token"],
  },
  AiAssistSettingsReplayContext: {
    schema: aiAssistSettingsReplayContextSchema,
    summary: "AI 辅助转换配置幂等重放的最小结果资源上下文",
    sensitiveFieldPaths: [],
  },
} satisfies Record<string, { schema: z.ZodType; summary: string; sensitiveFieldPaths: readonly string[] }>;
