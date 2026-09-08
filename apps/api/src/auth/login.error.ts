export type LoginErrorStatus = 401 | 403 | 409 | 422 | 429;

/** 登录命令的可预期业务错误；Controller 只把稳定错误信封返回给客户端。 */
export class LoginError extends Error {
  constructor(
    readonly status: LoginErrorStatus,
    readonly code: string,
    message: string,
    readonly reason: string,
  ) {
    super(message);
    this.name = "LoginError";
  }
}
