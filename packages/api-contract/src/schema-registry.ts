import type { z } from "zod";

import { errorResponseSchema } from "./contracts/error.zod.js";
import { healthResponseSchema } from "./contracts/health.zod.js";

export interface SchemaRegistryEntry {
  readonly schema: z.ZodType;
  readonly summary: string;
  /**
   * 技术设计 4.1.1 / ADR-019：标为敏感的叶子字段路径禁止进入幂等重放策略。
   * 路径记法与 collectLeafPaths 一致（对象用 `.`，数组用 `[]`）。
   */
  readonly sensitiveFieldPaths: readonly string[];
}

/**
 * Schema Registry 是请求与响应数据结构的唯一来源（技术设计 4.1）。
 * 每个条目必须通过 `.meta({ id })` 声明与键名一致的 OpenAPI 组件名。
 */
export const schemaRegistry = {
  ErrorResponse: {
    schema: errorResponseSchema,
    summary: "统一错误响应模型",
    sensitiveFieldPaths: [],
  },
  HealthResponse: {
    schema: healthResponseSchema,
    summary: "存活探针响应",
    sensitiveFieldPaths: [],
  },
} satisfies Record<string, SchemaRegistryEntry>;

export type SchemaName = keyof typeof schemaRegistry;

export const schemaNames = Object.keys(schemaRegistry) as readonly SchemaName[];

export function isSchemaName(value: string): value is SchemaName {
  return Object.hasOwn(schemaRegistry, value);
}
