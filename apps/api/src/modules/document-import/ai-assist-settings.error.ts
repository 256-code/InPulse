/**
 * ADR-068 AI 辅助转换配置的稳定业务错误；HTTP 层映射统一错误体。
 */
export class AiAssistSettingsError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "AiAssistSettingsError";
  }
}

/** 字段级校验失败；HTTP 层映射 422 并把字段写进 details。 */
export class AiAssistSettingsInputError extends Error {
  constructor(readonly fields: Readonly<Record<string, string>>) {
    super("invalid ai assist settings input");
    this.name = "AiAssistSettingsInputError";
  }
}
