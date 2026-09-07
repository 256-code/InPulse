import { z } from "zod";

// 技术设计 4.2：统一错误模型。任何非 2xx 响应都使用该结构，
// 数据库异常、堆栈与响应校验细节不得原样返回客户端。
export const errorResponseSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.record(z.string(), z.unknown()),
    requestId: z.string().min(1),
  })
  .meta({ id: "ErrorResponse" });

export type ErrorResponse = z.infer<typeof errorResponseSchema>;
