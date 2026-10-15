import { z } from "zod";

/** ADR-076：要求是「一句话」，不是对话，所以上限按一句话给。 */
export const RECORD_SUMMARY_ASSIST_MAX_REQUIREMENT_LENGTH = 500;
/**
 * 事实正文上限：由前端按当前筛选范围用既有确定性生成器（record-summary-document.ts）
 * 产出后随请求带上；服务端只做改写，不再查库。
 */
export const RECORD_SUMMARY_ASSIST_MAX_FACTS_LENGTH = 20_000;
/**
 * 改写正文上限与出站适配器的 MAX_MARKDOWN_CHARS 保持一致：超过这个长度
 * 适配器先按上游响应非法拒绝（不会走到这里），这里只是 Schema 侧的安全网。
 */
export const RECORD_SUMMARY_ASSIST_MAX_MARKDOWN_LENGTH = 200_000;

/**
 * ADR-076 迭代总结 AI 改写：把「当前范围的事实正文」按用户一句话要求改写。
 * 纯校验接口：不写任何持久化状态；facts 只回给发送者本人，不产生任何新的读权限。
 */
export const recordSummaryAssistRequestSchema = z
  .object({
    requirement: z
      .string()
      .min(1)
      .max(RECORD_SUMMARY_ASSIST_MAX_REQUIREMENT_LENGTH)
      .describe(
        "用户用一句话写的要求（给谁看、突出什么、篇幅多长），不是多轮对话",
      ),
    facts: z
      .string()
      .min(1)
      .max(RECORD_SUMMARY_ASSIST_MAX_FACTS_LENGTH)
      .describe(
        "当前筛选范围下已生成的事实正文全文（服务端不再查库，只改写这段文本）",
      ),
  })
  .strict()
  .meta({ id: "RecordSummaryAssistRequest" });

export const recordSummaryAssistResponseSchema = z
  .object({
    markdown: z
      .string()
      .min(1)
      .max(RECORD_SUMMARY_ASSIST_MAX_MARKDOWN_LENGTH)
      .describe("改写后的正文全文，由用户在弹窗里逐段确认或手动修改"),
    model: z.string().min(1).max(200).describe("实际调用并返回结果的模型标识"),
    truncated: z
      .boolean()
      .describe("上游因长度上限截断（finish_reason: length），正文可能不完整"),
  })
  .strict()
  .meta({ id: "RecordSummaryAssistResponse" });

export type RecordSummaryAssistRequest = z.infer<
  typeof recordSummaryAssistRequestSchema
>;
export type RecordSummaryAssistResponse = z.infer<
  typeof recordSummaryAssistResponseSchema
>;

export const recordSummaryAssistSchemas = {
  RecordSummaryAssistRequest: {
    schema: recordSummaryAssistRequestSchema,
    summary: "迭代总结 AI 改写请求：一句话要求与当前范围的事实正文",
    sensitiveFieldPaths: [],
  },
  RecordSummaryAssistResponse: {
    schema: recordSummaryAssistResponseSchema,
    summary: "迭代总结 AI 改写响应：改写正文、模型与截断标记",
    sensitiveFieldPaths: [],
  },
} as const;
