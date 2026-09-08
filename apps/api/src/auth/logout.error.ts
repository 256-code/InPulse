export type LogoutErrorStatus = 403;

/** 登出命令的可预期业务错误；Controller 只把稳定错误信封返回给客户端。 */
export class LogoutError extends Error {
  constructor(
    readonly status: LogoutErrorStatus,
    readonly code: string,
    message: string,
    readonly reason: string,
  ) {
    super(message);
    this.name = "LogoutError";
  }
}
