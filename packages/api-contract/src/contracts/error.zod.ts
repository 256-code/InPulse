import { z } from "zod";

// 技术设计 4.2：统一错误模型。任何非 2xx 响应都使用该结构，
// 数据库异常、堆栈与响应校验细节不得原样返回客户端。
// C-004 / C-008 裁决（docs/a-contract-review-frontend-consumption.md）：
// - details 无附加细节时必须是空对象 {}；保留键为 issues（422 校验摘要）
//   与 reason（错误码内稳定原因码），其余键只用于表单定位与诊断；
// - 前端逻辑只允许按 code 分支，message 是稳定诊断文案而不是机器契约。
export const errorResponseSchema = z
  .object({
    code: z
      .string()
      .min(1)
      .describe("机器可读错误码；客户端唯一允许的逻辑分支依据"),
    message: z
      .string()
      .min(1)
      .describe(
        "稳定诊断文案，可直接兜底展示；不是机器契约，前端不得按文案分支",
      ),
    details: z
      .record(z.string(), z.unknown())
      .describe(
        "附加细节；无附加细节时必须为空对象 {}。保留键：issues（422 校验摘要）、reason（错误码内稳定原因码）；其余键只用于表单定位与诊断",
      ),
    requestId: z
      .string()
      .min(1)
      .describe("服务端生成的排障引用，与响应头 X-Request-Id 同值"),
  })
  .meta({ id: "ErrorResponse" });

export type ErrorResponse = z.infer<typeof errorResponseSchema>;
