import { Logger } from "@nestjs/common";

import type { AiAssistConfig } from "./ai-assist.config.js";
import {
  buildAiAssistMessages,
  type DocumentImportAssistMode,
} from "./ai-assist.prompt.js";

/** ADR-067 的固定上游失败分类：仅进入 details.reason，不泄露上游细节。 */
export type AiAssistFailureReason =
  | "auth"
  | "rate-limited"
  | "timeout"
  | "network"
  | "context-limit"
  | "invalid-response";

/** 上游调用失败；HTTP 层统一映射 503 AI_ASSIST_UPSTREAM_FAILED + 固定 reason。 */
export class AiAssistUpstreamError extends Error {
  constructor(readonly reason: AiAssistFailureReason) {
    super(`AI assist upstream failure: ${reason}`);
    this.name = "AiAssistUpstreamError";
  }
}

export interface AiAssistDraft {
  readonly markdown: string;
  readonly model: string;
  /** 上游完成原因为长度上限（finish_reason: length）。 */
  readonly truncated: boolean;
}

const LOGGER_CONTEXT = "DocumentImportAiAssist";
const MAX_RESPONSE_JSON_CHARS = 2_000_000;
/** 契约输出上限 200000 字符；超出按上游响应非法处理（ADR-067 2.7）。 */
const MAX_MARKDOWN_CHARS = 200_000;
const ERROR_BODY_SNIFF_CHARS = 4_000;
/** 测试连接探测请求的固定内容；不含任何用户数据（ADR-068）。 */
const PROBE_CONTENT = "ping";

/**
 * OpenAI 兼容 chat/completions 出站适配器（ADR-067 2.2 / ADR-068）：
 * 只发送 model / messages / max_tokens / temperature / stream，不发送 Cookie、
 * CSRF 或用户凭证，不复用用户 Session，不自动重试；密钥只用于 Authorization
 * 头。配置由调用方逐次解析（数据库或环境变量），所有调用都在数据库事务之外。
 */
export class DocumentImportAiAssistClient {
  private readonly logger = new Logger(LOGGER_CONTEXT);

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async generateDraft(
    config: AiAssistConfig,
    input: {
      readonly mode: DocumentImportAssistMode;
      readonly text: string;
    },
  ): Promise<AiAssistDraft> {
    const startedAt = Date.now();
    const response = await this.callUpstream(
      config,
      {
        model: config.model,
        messages: buildAiAssistMessages(input),
        max_tokens: config.maxTokens,
        temperature: 0.2,
        stream: false,
      },
      startedAt,
      input,
    );
    const draft = await this.parseSuccessResponse(response, config);
    this.logCall(input, config, "ok", startedAt, undefined);
    return draft;
  }

  /**
   * ADR-068 测试连接：max_tokens=1 的最小探测请求；不发送用户数据。
   * 失败抛 AiAssistUpstreamError（HTTP 层映射固定分类）。
   */
  async probe(config: AiAssistConfig): Promise<{ readonly model: string }> {
    const startedAt = Date.now();
    const response = await this.callUpstream(
      config,
      {
        model: config.model,
        messages: [{ role: "user", content: PROBE_CONTENT }],
        max_tokens: 1,
        temperature: 0,
        stream: false,
      },
      startedAt,
      undefined,
    );
    let raw: string;
    try {
      raw = await response.text();
    } catch {
      throw new AiAssistUpstreamError("invalid-response");
    }
    if (raw.length > MAX_RESPONSE_JSON_CHARS) {
      throw new AiAssistUpstreamError("invalid-response");
    }
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new AiAssistUpstreamError("invalid-response");
    }
    const choices = isRecord(payload) ? payload["choices"] : undefined;
    const first = Array.isArray(choices) ? choices[0] : undefined;
    const message =
      isRecord(first) && isRecord(first["message"])
        ? first["message"]
        : undefined;
    if (message === undefined || typeof message["content"] !== "string") {
      throw new AiAssistUpstreamError("invalid-response");
    }
    const responseModel = isRecord(payload) ? payload["model"] : undefined;
    const model =
      typeof responseModel === "string" && responseModel.trim().length > 0
        ? responseModel.trim().slice(0, 200)
        : config.model;
    this.logCall(undefined, config, "ok", startedAt, undefined);
    return { model };
  }

  private async callUpstream(
    config: AiAssistConfig,
    body: Readonly<Record<string, unknown>>,
    startedAt: number,
    input:
      | { readonly mode: DocumentImportAssistMode; readonly text: string }
      | undefined,
  ): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImpl(config.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (error) {
      const reason: AiAssistFailureReason = isAbortLikeError(error)
        ? "timeout"
        : "network";
      this.logCall(input, config, "failed", startedAt, reason);
      throw new AiAssistUpstreamError(reason);
    }
    if (!response.ok) {
      const reason = await this.classifyErrorResponse(response);
      this.logCall(input, config, "failed", startedAt, reason);
      throw new AiAssistUpstreamError(reason);
    }
    return response;
  }

  private async classifyErrorResponse(
    response: Response,
  ): Promise<AiAssistFailureReason> {
    if (response.status === 401 || response.status === 403) {
      return "auth";
    }
    if (response.status === 429) {
      return "rate-limited";
    }
    // 读取有限长度的上游错误体做上下文超限启发式判断；正文不进日志。
    let bodyText: string;
    try {
      bodyText = (await response.text()).slice(0, ERROR_BODY_SNIFF_CHARS);
    } catch {
      bodyText = "";
    }
    if (
      response.status === 400 ||
      response.status === 413 ||
      response.status === 422
    ) {
      if (/context|token|too long|maximum|length/i.test(bodyText)) {
        return "context-limit";
      }
    }
    return "invalid-response";
  }

  private async parseSuccessResponse(
    response: Response,
    config: AiAssistConfig,
  ): Promise<AiAssistDraft> {
    let raw: string;
    try {
      raw = await response.text();
    } catch {
      throw new AiAssistUpstreamError("invalid-response");
    }
    if (raw.length > MAX_RESPONSE_JSON_CHARS) {
      throw new AiAssistUpstreamError("invalid-response");
    }
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new AiAssistUpstreamError("invalid-response");
    }
    const choices = isRecord(payload) ? payload["choices"] : undefined;
    const first = Array.isArray(choices) ? choices[0] : undefined;
    const message =
      isRecord(first) && isRecord(first["message"])
        ? first["message"]
        : undefined;
    const content = message === undefined ? undefined : message["content"];
    const finishReason = isRecord(first) ? first["finish_reason"] : undefined;
    if (typeof content !== "string") {
      throw new AiAssistUpstreamError("invalid-response");
    }
    const markdown = content.trim();
    if (markdown.length === 0 || markdown.length > MAX_MARKDOWN_CHARS) {
      throw new AiAssistUpstreamError("invalid-response");
    }
    const responseModel = isRecord(payload) ? payload["model"] : undefined;
    const model =
      typeof responseModel === "string" && responseModel.trim().length > 0
        ? responseModel.trim().slice(0, 200)
        : config.model;
    return {
      markdown,
      model,
      truncated: finishReason === "length",
    };
  }

  private logCall(
    input:
      | { readonly mode: DocumentImportAssistMode; readonly text: string }
      | undefined,
    config: AiAssistConfig,
    status: "ok" | "failed",
    startedAt: number,
    reason: AiAssistFailureReason | undefined,
  ): void {
    // 只记录调用元数据，不记录正文与密钥（ADR-067 2.5 / ADR-068 2.3）。
    const line = JSON.stringify({
      kind: input === undefined ? "probe" : "draft",
      mode: input?.mode ?? "PROBE",
      model: config.model,
      inputChars: input?.text.length ?? 0,
      status,
      reason: reason ?? "none",
      elapsedMs: Date.now() - startedAt,
    });
    if (status === "ok") {
      this.logger.log(line);
    } else {
      this.logger.warn(line);
    }
  }
}

function isAbortLikeError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.name === "TimeoutError" || error.name === "AbortError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
