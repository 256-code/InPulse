import { readFileSync } from "node:fs";

/** AI 辅助转换的 OpenAI 兼容端点配置（ADR-067）。 */
export interface AiAssistConfig {
  readonly endpoint: string;
  readonly model: string;
  readonly apiKey: string;
  readonly timeoutMs: number;
  readonly maxTokens: number;
}

export interface AiAssistConfigLoadResult {
  readonly config: AiAssistConfig | undefined;
  /** 已启用但配置非法时的分类原因；只用于启动日志，不含任何 Secret。 */
  readonly invalidReason: string | undefined;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_TOKENS = 8192;
const TIMEOUT_MIN_MS = 1_000;
const TIMEOUT_MAX_MS = 600_000;
const MAX_TOKENS_MIN = 1;
const MAX_TOKENS_MAX = 200_000;

/**
 * ADR-068 急停开关：`AI_ASSIST_ENABLED` 显式设为非空且非真值时，无论数据库
 * 配置如何都强制关闭；未设置或空串表示不启用急停（由数据库配置决定）。
 */
export function aiAssistEmergencyStop(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  const raw = env["AI_ASSIST_ENABLED"]?.trim().toLowerCase();
  return raw !== undefined && raw.length > 0 && raw !== "1" && raw !== "true";
}

/** `AI_ASSIST_ENABLED` 非真值即整体关闭（默认关闭；本地与 CI 默认）。 */
export function aiAssistEnabled(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  const raw = env["AI_ASSIST_ENABLED"]?.trim().toLowerCase();
  return raw === "1" || raw === "true";
}

/**
 * 读取 AI 辅助转换配置（ADR-067，与 SSO 配置 fail-closed 同构）：
 * 未启用时视为关闭；已启用但端点 / 模型 / Secret 文件非法时返回分类原因并
 * fail closed——不发起任何上游调用，对外统一按未启用处理，绝不接受明文
 * Secret 环境变量兜底。端点必须为 https；dev / test 允许回环 http 供 stub。
 */
export function loadAiAssistConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): AiAssistConfigLoadResult {
  if (!aiAssistEnabled(env)) {
    return { config: undefined, invalidReason: undefined };
  }
  try {
    const endpoint = normalizeEndpoint(env);
    const model = required(env, "AI_ASSIST_MODEL");
    if (model.length > 200) {
      throw new Error("AI_ASSIST_MODEL must be at most 200 characters");
    }
    const apiKey = readApiKey(env);
    const timeoutMs = optionalInteger(
      env,
      "AI_ASSIST_TIMEOUT_MS",
      DEFAULT_TIMEOUT_MS,
      TIMEOUT_MIN_MS,
      TIMEOUT_MAX_MS,
    );
    const maxTokens = optionalInteger(
      env,
      "AI_ASSIST_MAX_TOKENS",
      DEFAULT_MAX_TOKENS,
      MAX_TOKENS_MIN,
      MAX_TOKENS_MAX,
    );
    return {
      config: { endpoint, model, apiKey, timeoutMs, maxTokens },
      invalidReason: undefined,
    };
  } catch (error) {
    return {
      config: undefined,
      invalidReason: error instanceof Error ? error.message : "invalid",
    };
  }
}

/**
 * 端点规则（ADR-067 / ADR-068 共用）：必须是绝对 https URL；仅非 production
 * 的回环 http 放行（本地 stub 与测试）。非法时抛错，由调用方 fail closed。
 */
export function validateAiAssistEndpoint(
  value: string,
  env: Readonly<Record<string, string | undefined>>,
  variableName: string,
): string {
  const parsed = parseUrl(value);
  if (parsed === undefined) {
    throw new Error(`${variableName} must be an absolute URL`);
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
  throw new Error(`${variableName} must be an absolute https URL`);
}

function normalizeEndpoint(
  env: Readonly<Record<string, string | undefined>>,
): string {
  return validateAiAssistEndpoint(
    required(env, "AI_ASSIST_ENDPOINT"),
    env,
    "AI_ASSIST_ENDPOINT",
  );
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]"
  );
}

function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function required(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = env[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required when AI assist is enabled`);
  }
  return value;
}

function optionalInteger(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[name]?.trim();
  if (raw === undefined || raw.length === 0) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

/**
 * 读取 API Key 文件。生产只接受 `/run/secrets/` 直接子路径；本地 / 集成
 * 测试必须显式设置 `NODE_ENV=test` 与 `AI_ASSIST_API_KEY_TEST_PATH=1` 才
 * 允许临时路径；其余情况一律 fail closed。
 */
function readApiKey(env: Readonly<Record<string, string | undefined>>): string {
  const path = required(env, "AI_ASSIST_API_KEY_FILE");
  const allowTestPath =
    env["NODE_ENV"] === "test" && env["AI_ASSIST_API_KEY_TEST_PATH"] === "1";
  if (!allowTestPath && !path.startsWith("/run/secrets/")) {
    throw new Error("AI_ASSIST_API_KEY_FILE must be under /run/secrets/");
  }
  let content: string;
  try {
    content = readFileSync(path, "utf8").trim();
  } catch {
    throw new Error("AI_ASSIST_API_KEY_FILE is not readable");
  }
  if (content.length === 0) {
    throw new Error("AI_ASSIST_API_KEY_FILE is empty");
  }
  return content;
}
