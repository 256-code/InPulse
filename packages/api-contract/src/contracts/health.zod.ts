import { z } from "zod";

// 存活探针响应。当前 apps/api 只实现该路由，契约登记范围与实现保持一致。
export const healthResponseSchema = z
  .object({
    status: z.literal("ok"),
  })
  .meta({ id: "HealthResponse" });

export type HealthResponse = z.infer<typeof healthResponseSchema>;
