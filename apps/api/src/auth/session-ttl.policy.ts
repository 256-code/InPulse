import { SESSION_ABSOLUTE_MAX_AGE_SECONDS } from "./csrf.http.js";

/** NestJS DI token：本地会话有效期策略。 */
export const SESSION_TTL_POLICY = Symbol("SESSION_TTL_POLICY");

/**
 * ADR-038：本地会话空闲有效期默认 2 小时（7200 秒，自签发起，不随请求滑动续期）；
 * 口令登录与 SSO 登录共用同一策略，避免两条签发路径出现不一致的过期语义。
 */
export const DEFAULT_SESSION_IDLE_MAX_AGE_SECONDS = 2 * 60 * 60;

export interface SessionTtlPolicy {
  readonly idleMaxAgeSeconds: number;
  readonly absoluteMaxAgeSeconds: number;
}

export function sessionTtlPolicyFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): SessionTtlPolicy {
  return {
    idleMaxAgeSeconds: positiveIntegerFromEnv(
      env,
      "SESSION_IDLE_MAX_AGE_SECONDS",
      DEFAULT_SESSION_IDLE_MAX_AGE_SECONDS,
    ),
    absoluteMaxAgeSeconds: SESSION_ABSOLUTE_MAX_AGE_SECONDS,
  };
}

function positiveIntegerFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  fallback: number,
): number {
  const raw = env[name]?.trim();
  if (raw === undefined || raw === "") {
    return fallback;
  }
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`${name} must be a positive integer`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${name} must be a safe integer`);
  }
  return value;
}
