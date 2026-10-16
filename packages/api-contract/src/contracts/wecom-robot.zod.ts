import { z } from "zod";

const id = z.number().int().positive().max(2147483647);

/**
 * 机器人资料链接（botProfileUrl）：https 协议、1–512 字符，标准 URL Parser
 * 校验（与迁移 0043 的数据库 CHECK 同口径）。仅作展示：成员「绑定企业微信」
 * 弹窗用它指引在企业微信中打开机器人，非敏感字段。
 */
const botProfileUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .refine(
    (value) => {
      try {
        return new URL(value).protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: "机器人链接必须是 https 开头的合法网址" },
  );

/**
 * ADR-070 企业微信机器人管理员配置（GET / PUT 响应）。
 * 永不返回密钥明文或密文：只返回 botId、密钥尾 4 位提示、机器人链接与
 * 是否已配置。
 */
export const wecomRobotDisabledReasonSchema = z.enum([
  "NOT_CONFIGURED",
  "ENCRYPTION_KEY_UNAVAILABLE",
  "CONFIG_INVALID",
]);

export const wecomRobotConfigSchema = z
  .object({
    configured: z.boolean().describe("是否已保存过机器人配置"),
    ready: z
      .boolean()
      .describe("桥接当前是否可直接使用该配置（密文可用当前主密钥解密）"),
    disabledReason: wecomRobotDisabledReasonSchema.nullable(),
    botId: z.string().min(1).max(128).nullable(),
    secretHint: z
      .string()
      .min(1)
      .max(16)
      .nullable()
      .describe("密钥尾 4 位提示；不回显密钥本身"),
    secretKeyVersion: z.number().int().min(1).max(2147483647).nullable(),
    rowVersion: z.number().int().min(1).max(2147483647).nullable(),
    botProfileUrl: z
      .string()
      .min(1)
      .max(512)
      .nullable()
      .describe(
        "机器人资料链接；未配置为 null；展示在成员「绑定企业微信」弹窗",
      ),
    updatedAt: z.iso.datetime().nullable(),
    updatedByName: z
      .string()
      .min(1)
      .max(200)
      .nullable()
      .describe("最近一次保存人的显示名；用于管理页核对变更来源"),
    revokedUserBindings: z
      .number()
      .int()
      .min(0)
      .max(2147483647)
      .nullable()
      .describe(
        "本次保存是否因更换机器人触发解绑：未更换为 null，更换时为本事务解除的个人绑定数（可能为 0）",
      ),
    revokedProjectGroups: z
      .number()
      .int()
      .min(0)
      .max(2147483647)
      .nullable()
      .describe(
        "本次保存是否因更换机器人触发解绑：未更换为 null，更换时为本事务解除的项目群绑定数（可能为 0）",
      ),
  })
  .strict()
  .meta({ id: "WecomRobotConfig" });

/**
 * 保存配置：botId 必填；secret 缺省或 null 表示保持已存密钥不变；
 * botProfileUrl 缺省表示保持现值、null 表示清空、字符串表示设置为该链接。
 */
export const wecomRobotConfigUpdateRequestSchema = z
  .object({
    botId: z.string().trim().min(1).max(128),
    secret: z.string().trim().min(1).max(256).nullable().optional(),
    botProfileUrl: botProfileUrlSchema
      .nullable()
      .optional()
      .describe("机器人资料链接（https，1–512）；缺省保持现值、null 清空"),
  })
  .strict()
  .meta({ id: "WecomRobotConfigUpdateRequest" });

/** 管理员配置写请求头；CSRF 同步 Token 必填。 */
export const wecomRobotMutationHeadersSchema = z
  .object({ "x-csrf-token": z.string().length(43) })
  .strict()
  .meta({ id: "WecomRobotMutationHeaders" });

/** 幂等重放授权上下文：单行配置 + 原始管理员。 */
export const wecomRobotReplayContextSchema = z
  .object({ actorUserId: id, robotConfigRowId: id })
  .strict()
  .meta({ id: "WecomRobotReplayContext" });

export type WecomRobotDisabledReason = z.infer<
  typeof wecomRobotDisabledReasonSchema
>;
export type WecomRobotConfig = z.infer<typeof wecomRobotConfigSchema>;
export type WecomRobotConfigUpdateRequest = z.infer<
  typeof wecomRobotConfigUpdateRequestSchema
>;
export type WecomRobotReplayContext = z.infer<
  typeof wecomRobotReplayContextSchema
>;

export const wecomRobotSchemas = {
  WecomRobotConfig: {
    schema: wecomRobotConfigSchema,
    summary:
      "企业微信机器人管理员配置视图；只含密钥尾号与机器人链接，不回显密钥",
    sensitiveFieldPaths: [],
  },
  WecomRobotConfigUpdateRequest: {
    schema: wecomRobotConfigUpdateRequestSchema,
    summary:
      "企业微信机器人配置保存请求；secret 只接收一次、加密落库；botProfileUrl 缺省保持、null 清空",
    sensitiveFieldPaths: ["secret"],
  },
  WecomRobotMutationHeaders: {
    schema: wecomRobotMutationHeadersSchema,
    summary: "企业微信机器人配置写请求头，要求同步 CSRF Token",
    sensitiveFieldPaths: ["x-csrf-token"],
  },
  WecomRobotReplayContext: {
    schema: wecomRobotReplayContextSchema,
    summary: "企业微信机器人配置幂等重放的最小结果资源上下文",
    sensitiveFieldPaths: [],
  },
} satisfies Record<
  string,
  { schema: z.ZodType; summary: string; sensitiveFieldPaths: readonly string[] }
>;
