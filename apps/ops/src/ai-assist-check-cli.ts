#!/usr/bin/env node
import { pathToFileURL } from "node:url";

import { readTrimmedSecret } from "@inpulse/database/config";

/**
 * ADR-067 运维自检：探测 AI 辅助转换的端点 / 密钥 / 模型可用性。
 *
 * 只读探测：向配置的 OpenAI 兼容 chat/completions 发送一条最小请求
 * （max_tokens=1、temperature=0），验证地址、密钥与模型可用且响应形状符合
 * API 适配器预期。不发送任何用户数据、不打印密钥、不写数据库；手工运行，
 * 不新增根级命令、不纳入 CI（ADR-067 §3）。
 *
 * 用法（省略参数时读取同名环境变量，语义与 API 侧一致）：
 *   node dist/ai-assist-check-cli.js
 *     [--endpoint <chat/completions 完整地址；生产必须 https>]
 *     [--model <模型名>]
 *     [--key-file <密钥文件；生产只接受 /run/secrets/ 直接子路径>]
 *     [--timeout-ms <毫秒>]
 *
 * 退出码：0 探测通过；1 用法 / 配置错误；2 上游探测失败。
 */

const DEFAULT_TIMEOUT_MS = 60_000;
const TIMEOUT_MIN_MS = 1_000;
const TIMEOUT_MAX_MS = 600_000;

export const AI_ASSIST_CHECK_USAGE = [
  "用法：node dist/ai-assist-check-cli.js [选项]（省略时读同名环境变量）",
  "",
  "  --endpoint <url>     OpenAI 兼容 chat/completions 完整地址（AI_ASSIST_ENDPOINT；生产必须 https）",
  "  --model <name>       模型名（AI_ASSIST_MODEL）",
  "  --key-file <path>    密钥文件（AI_ASSIST_API_KEY_FILE；生产只接受 /run/secrets/ 直接子路径）",
  "  --timeout-ms <ms>    请求超时（AI_ASSIST_TIMEOUT_MS，默认 " +
    String(DEFAULT_TIMEOUT_MS) +
    "）",
  "  --help               显示本说明",
  "",
  "只读探测：发送一条 max_tokens=1 的最小请求验证端点 / 密钥 / 模型可用；",
  "不发送用户数据、不打印密钥、不写数据库。",
  "退出码：0 探测通过；1 用法或配置错误；2 上游探测失败。",
].join("\n");

export interface AiAssistCheckOptions {
  readonly endpoint: string;
  readonly model: string;
  readonly keyFile: string;
  readonly timeoutMs: number;
}

function parseFlags(argv: readonly string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined || !token.startsWith("--")) {
      throw new Error("unexpected argument: " + (token ?? ""));
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error("missing value for " + token);
    }
    flags.set(token, value);
    index += 1;
  }
  return flags;
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]"
  );
}

/** 与 API 侧 normalizeEndpoint 同一规则：https，或非 production 的回环 http。 */
function validateEndpoint(
  value: string,
  env: Readonly<Record<string, string | undefined>>,
): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("endpoint must be an absolute URL");
  }
  if (parsed.protocol === "https:") {
    return value;
  }
  if (
    parsed.protocol === "http:" &&
    isLoopbackHost(parsed.hostname) &&
    env["NODE_ENV"] !== "production"
  ) {
    return value;
  }
  throw new Error("endpoint must be an absolute https URL");
}

function parseTimeout(raw: string): number {
  const value = Number(raw);
  if (
    !Number.isInteger(value) ||
    value < TIMEOUT_MIN_MS ||
    value > TIMEOUT_MAX_MS
  ) {
    throw new Error(
      "timeout-ms must be an integer between " +
        String(TIMEOUT_MIN_MS) +
        " and " +
        String(TIMEOUT_MAX_MS),
    );
  }
  return value;
}

export function resolveAiAssistCheckOptions(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>> = process.env,
): AiAssistCheckOptions {
  const flags = parseFlags(argv);
  const endpoint = flags.get("--endpoint") ?? env["AI_ASSIST_ENDPOINT"]?.trim();
  if (endpoint === undefined || endpoint.length === 0) {
    throw new Error("endpoint is required (--endpoint or AI_ASSIST_ENDPOINT)");
  }
  const model = flags.get("--model") ?? env["AI_ASSIST_MODEL"]?.trim();
  if (model === undefined || model.length === 0 || model.length > 200) {
    throw new Error(
      "model is required (--model or AI_ASSIST_MODEL, at most 200 characters)",
    );
  }
  const keyFile =
    flags.get("--key-file") ?? env["AI_ASSIST_API_KEY_FILE"]?.trim();
  if (keyFile === undefined || keyFile.length === 0) {
    throw new Error(
      "key file is required (--key-file or AI_ASSIST_API_KEY_FILE)",
    );
  }
  const timeoutRaw =
    flags.get("--timeout-ms") ??
    env["AI_ASSIST_TIMEOUT_MS"]?.trim() ??
    String(DEFAULT_TIMEOUT_MS);
  return {
    endpoint: validateEndpoint(endpoint, env),
    model,
    keyFile,
    timeoutMs: parseTimeout(timeoutRaw),
  };
}

export type AiAssistProbeFailure =
  "auth" | "rate-limited" | "timeout" | "network" | "invalid-response";

export class AiAssistProbeError extends Error {
  constructor(
    readonly reason: AiAssistProbeFailure,
    message: string,
  ) {
    super(message);
    this.name = "AiAssistProbeError";
  }
}

const PROBE_CONTENT_MARK = "ping";

export interface AiAssistProbeResult {
  readonly model: string;
  readonly contentChars: number;
}

/**
 * 最小探测请求；响应形状与 DocumentImportAiAssistClient 一致
 * （choices[0].message.content 必须是字符串；finish_reason 不参与判定）。
 */
export async function probeAiAssistUpstream(
  config: AiAssistCheckOptions,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AiAssistProbeResult> {
  let response: Response;
  try {
    response = await fetchImpl(config.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + apiKey,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: "user", content: PROBE_CONTENT_MARK }],
        max_tokens: 1,
        temperature: 0,
        stream: false,
      }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      throw new AiAssistProbeError(
        "timeout",
        "upstream timed out after " + String(config.timeoutMs) + " ms",
      );
    }
    throw new AiAssistProbeError(
      "network",
      "upstream request failed (network)",
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw new AiAssistProbeError(
      "auth",
      "upstream rejected the api key (HTTP " + String(response.status) + ")",
    );
  }
  if (response.status === 429) {
    throw new AiAssistProbeError(
      "rate-limited",
      "upstream rate limited the probe (HTTP 429)",
    );
  }
  if (!response.ok) {
    throw new AiAssistProbeError(
      "invalid-response",
      "upstream returned HTTP " + String(response.status),
    );
  }
  let payload: unknown;
  try {
    payload = JSON.parse(await response.text());
  } catch {
    throw new AiAssistProbeError(
      "invalid-response",
      "upstream response is not valid JSON",
    );
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    throw new AiAssistProbeError(
      "invalid-response",
      "upstream response shape is invalid",
    );
  }
  const record = payload as Record<string, unknown>;
  const choices = record["choices"];
  const first = Array.isArray(choices) ? choices[0] : undefined;
  const message =
    typeof first === "object" && first !== null && !Array.isArray(first)
      ? (first as Record<string, unknown>)["message"]
      : undefined;
  const content =
    typeof message === "object" && message !== null && !Array.isArray(message)
      ? (message as Record<string, unknown>)["content"]
      : undefined;
  if (typeof content !== "string") {
    throw new AiAssistProbeError(
      "invalid-response",
      "upstream response has no choices[0].message.content",
    );
  }
  const responseModel = record["model"];
  return {
    model:
      typeof responseModel === "string" && responseModel.trim().length > 0
        ? responseModel.trim().slice(0, 200)
        : config.model,
    contentChars: content.length,
  };
}

async function main(argv: readonly string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(AI_ASSIST_CHECK_USAGE);
    return 0;
  }
  let options: AiAssistCheckOptions;
  try {
    options = resolveAiAssistCheckOptions(argv);
  } catch (error) {
    console.error(
      "inpulse-ai-assist-check: " +
        (error instanceof Error ? error.message : "invalid arguments"),
    );
    console.error(AI_ASSIST_CHECK_USAGE);
    return 1;
  }
  let apiKey: string;
  try {
    apiKey = await readTrimmedSecret(options.keyFile, "AI_ASSIST_API_KEY_FILE");
  } catch (error) {
    console.error(
      "inpulse-ai-assist-check: " +
        (error instanceof Error ? error.message : "invalid key file"),
    );
    return 1;
  }
  try {
    const result = await probeAiAssistUpstream(options, apiKey);
    console.log(
      JSON.stringify({
        ok: true,
        endpoint: options.endpoint,
        model: result.model,
        contentChars: result.contentChars,
      }),
    );
    return 0;
  } catch (error) {
    if (error instanceof AiAssistProbeError) {
      console.error(
        "inpulse-ai-assist-check: " + error.reason + ": " + error.message,
      );
      return 2;
    }
    console.error(
      "inpulse-ai-assist-check: " +
        (error instanceof Error ? error.message : "probe failed"),
    );
    return 2;
  }
}

// 只在作为入口运行时执行；单元测试 import 本模块不会触发探测。
const invokedAsEntry =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsEntry) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error("inpulse-ai-assist-check: " + message);
      process.exitCode = 1;
    });
}
