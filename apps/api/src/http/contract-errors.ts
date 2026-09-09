export type ContractRequestPart = "path" | "query" | "headers" | "body";

export interface ZodIssueLike {
  readonly path: readonly unknown[];
  readonly message: string;
}

export interface ZodErrorLike {
  readonly issues: readonly ZodIssueLike[];
}

export class ContractValidationError extends Error {
  readonly statusCode = 422;

  constructor(
    readonly operationId: string,
    readonly part: ContractRequestPart,
    readonly issues: readonly {
      readonly path: string;
      readonly message: string;
    }[],
  ) {
    super(`contract request validation failed: ${operationId}.${part}`);
    this.name = "ContractValidationError";
  }
}

export class ContractResponseError extends Error {
  readonly statusCode = 500;

  constructor(
    readonly operationId: string,
    readonly status: number,
  ) {
    super(`contract response validation failed: ${operationId} ${status}`);
    this.name = "ContractResponseError";
  }
}

/**
 * 可由 Guard/Interceptor 安全抛出的显式 HTTP 契约错误。与控制器内层
 * `@Res({ passthrough: true })` 手工映射不同，这里只承载固定、脱敏的
 * 错误信息，不会把框架或内部异常文本返回客户端。
 */
export class ApiHttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "ApiHttpError";
  }
}

export function contractIssuesFromZod(error: ZodErrorLike): readonly {
  readonly path: string;
  readonly message: string;
}[] {
  return error.issues.map((issue) => ({
    path: issue.path.length === 0 ? "$" : issue.path.map(String).join("."),
    message: issue.message,
  }));
}
