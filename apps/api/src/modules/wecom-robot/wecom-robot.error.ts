/**
 * ADR-070 机器人配置的稳定业务错误；HTTP 层映射统一错误体。
 */
export class WecomRobotConfigError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "WecomRobotConfigError";
  }
}

/** 字段级校验失败；HTTP 层映射 422 并把字段写进 details。 */
export class WecomRobotInputError extends Error {
  constructor(readonly fields: Readonly<Record<string, string>>) {
    super("invalid wecom robot config input");
    this.name = "WecomRobotInputError";
  }
}
