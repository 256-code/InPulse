import type { z } from "zod";

import {
  loginHeadersSchema,
  loginRequestSchema,
  loginResponseSchema,
  logoutHeadersSchema,
  currentUserResponseSchema,
  userAuthStateSchema,
} from "./contracts/auth.zod.js";
import { csrfIssueResponseSchema } from "./contracts/csrf.zod.js";
import { errorResponseSchema } from "./contracts/error.zod.js";
import { healthResponseSchema } from "./contracts/health.zod.js";
import {
  searchItemSchema,
  searchPageSchema,
  searchQueryRequestSchema,
} from "./contracts/search.zod.js";

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
  CsrfIssueResponse: {
    schema: csrfIssueResponseSchema,
    summary: "CSRF 同步 Token 签发响应",
    sensitiveFieldPaths: ["csrfToken"],
  },
  LoginHeaders: {
    schema: loginHeadersSchema,
    summary: "登录请求头",
    sensitiveFieldPaths: ["x-csrf-token"],
  },
  LoginRequest: {
    schema: loginRequestSchema,
    summary: "登录请求体",
    sensitiveFieldPaths: ["password"],
  },
  LoginResponse: {
    schema: loginResponseSchema,
    summary: "登录成功响应，返回绑定新 Session 的 CSRF Token 与显式认证状态",
    sensitiveFieldPaths: ["csrfToken"],
  },
  LogoutHeaders: {
    schema: logoutHeadersSchema,
    summary: "登出请求头；有效 Session 必须携带当前 CSRF Token",
    sensitiveFieldPaths: ["x-csrf-token"],
  },
  SearchQueryRequest: {
    schema: searchQueryRequestSchema,
    summary:
      "全局搜索查询参数；cursor 为服务端签名的不透明字符串，limit 默认 20、最大 50",
    sensitiveFieldPaths: [],
  },
  SearchItem: {
    schema: searchItemSchema,
    summary: "搜索结果条目，entityType 为稳定判别字段",
    sensitiveFieldPaths: [],
  },
  SearchPage: {
    schema: searchPageSchema,
    summary: "全局搜索分页结果",
    sensitiveFieldPaths: [],
  },
  UserAuthState: {
    schema: userAuthStateSchema,
    summary: "用户 Session 显式认证状态",
    sensitiveFieldPaths: [],
  },
  CurrentUserResponse: {
    schema: currentUserResponseSchema,
    summary: "当前登录用户资料",
    sensitiveFieldPaths: [],
  },
} satisfies Record<string, SchemaRegistryEntry>;

export type SchemaName = keyof typeof schemaRegistry;

export const schemaNames = Object.keys(schemaRegistry) as readonly SchemaName[];

export function isSchemaName(value: string): value is SchemaName {
  return Object.hasOwn(schemaRegistry, value);
}
