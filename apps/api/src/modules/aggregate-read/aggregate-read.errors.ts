/** 聚合读（R-1 ~ R-4）的业务错误：Controller 按 status/code 映射错误体。 */
export type AggregateReadErrorStatus = 401 | 404 | 422 | 500;

export class AggregateReadError extends Error {
  readonly status: AggregateReadErrorStatus;
  readonly code: string;

  constructor(status: AggregateReadErrorStatus, code: string, message: string) {
    super(message);
    this.name = "AggregateReadError";
    this.status = status;
    this.code = code;
  }
}

export function invalidCursorError(): AggregateReadError {
  return new AggregateReadError(
    422,
    "INVALID_CURSOR",
    "游标无效、已过期或与当前筛选条件不匹配",
  );
}
