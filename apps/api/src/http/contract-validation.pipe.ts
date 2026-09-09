import { type PipeTransform } from "@nestjs/common";

import {
  ContractValidationError,
  contractIssuesFromZod,
  type ContractRequestPart,
} from "./contract-errors.js";
import { getRequestSchema } from "./contract-runtime.js";

/**
 * 从 Route Registry 定位操作与请求 Schema 的 Zod Pipe。
 * Schema 校验失败统一抛出 ContractValidationError，由 ExceptionFilter
 * 转换为 422 契约错误体，不直接泄漏 ZodError 内部格式。
 */
export class ContractValidationPipe implements PipeTransform {
  constructor(
    private readonly operationId: string,
    private readonly part: ContractRequestPart,
  ) {}

  transform(value: unknown): unknown {
    const schema = getRequestSchema(this.operationId, this.part);
    if (schema === undefined) {
      return value;
    }
    const requestValue =
      this.part === "headers"
        ? pickDeclaredHeaders(value, schema.headerKeys ?? [])
        : value;
    const parsed = schema.safeParse(requestValue);
    if (!parsed.success) {
      throw new ContractValidationError(
        this.operationId,
        this.part,
        contractIssuesFromZod(parsed.error),
      );
    }
    return parsed.data;
  }
}

function pickDeclaredHeaders(value: unknown, keys: readonly string[]): unknown {
  if (
    keys.length === 0 ||
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return value;
  }
  const source = value as Readonly<Record<string, unknown>>;
  const selected: Record<string, unknown> = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      selected[key] = source[key];
    }
  }
  return selected;
}
