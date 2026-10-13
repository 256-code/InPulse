import { z } from "zod";

const id = z.number().int().positive().max(2147483647);

/**
 * ADR-069 企业微信绑定三态：
 * UNBOUND 未绑定且无待用码；PENDING 已生成待用绑定码；BOUND 已绑定。
 */
export const wecomBindingStateSchema = z.enum(["UNBOUND", "PENDING", "BOUND"]);

/** 当前用户的企微机器人绑定状态（GET 响应）。 */
export const wecomBindingStatusSchema = z
  .object({
    state: wecomBindingStateSchema.describe(
      "UNBOUND 未绑定且无待用码；PENDING 有待用绑定码；BOUND 已绑定",
    ),
    boundAt: z.iso
      .datetime()
      .nullable()
      .describe("当前 ACTIVE 绑定的时间；未绑定为 null"),
    codeExpiresAt: z.iso
      .datetime()
      .nullable()
      .describe("当前待用绑定码的过期时间；无待用码为 null"),
  })
  .strict()
  .meta({ id: "WecomBindingStatus" });

/**
 * 新签发的一次性绑定码（POST 响应）。明文码只在本响应返回一次：
 * 服务端只保存 SHA-256 Hash，10 分钟有效、一次性消费（ADR-069）。
 */
export const wecomBindingCodeSchema = z
  .object({
    code: z
      .string()
      .regex(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/)
      .describe(
        "16 位 Crockford Base32 绑定码（4 组 4 位，不含易混字符 I / L / O / U）；发送给企微机器人完成绑定",
      ),
    expiresAt: z.iso.datetime(),
  })
  .strict()
  .meta({ id: "WecomBindingCode" });

/** 企微绑定写请求头；CSRF 同步 Token 必填。 */
export const wecomBindingMutationHeadersSchema = z
  .object({ "x-csrf-token": z.string().length(43) })
  .strict()
  .meta({ id: "WecomBindingMutationHeaders" });

/** 解除绑定幂等重放授权上下文：只涉及操作者本人，无其它结果资源。 */
export const wecomBindingReplayContextSchema = z
  .object({ actorUserId: id })
  .strict()
  .meta({ id: "WecomBindingReplayContext" });

export type WecomBindingState = z.infer<typeof wecomBindingStateSchema>;
export type WecomBindingStatus = z.infer<typeof wecomBindingStatusSchema>;
export type WecomBindingCode = z.infer<typeof wecomBindingCodeSchema>;
export type WecomBindingReplayContext = z.infer<
  typeof wecomBindingReplayContextSchema
>;

export const wecomBindingSchemas = {
  WecomBindingStatus: {
    schema: wecomBindingStatusSchema,
    summary: "当前用户的企微机器人绑定状态与待用码过期时间",
    sensitiveFieldPaths: [],
  },
  WecomBindingCode: {
    schema: wecomBindingCodeSchema,
    summary: "一次性企微绑定码；明文只返回一次，服务端只存 Hash",
    sensitiveFieldPaths: ["code"],
  },
  WecomBindingMutationHeaders: {
    schema: wecomBindingMutationHeadersSchema,
    summary: "企微绑定写请求头，要求同步 CSRF Token",
    sensitiveFieldPaths: ["x-csrf-token"],
  },
  WecomBindingReplayContext: {
    schema: wecomBindingReplayContextSchema,
    summary: "企微绑定解绑幂等重放的最小授权上下文（仅操作者本人）",
    sensitiveFieldPaths: [],
  },
} satisfies Record<
  string,
  { schema: z.ZodType; summary: string; sensitiveFieldPaths: readonly string[] }
>;
