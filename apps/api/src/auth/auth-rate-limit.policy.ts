export type AuthRateLimitBucketType = "ACCOUNT" | "IP" | "GLOBAL" | "MFA";

export interface AuthRateLimitRule {
  readonly bucketType: AuthRateLimitBucketType;
  readonly windowSeconds: number;
  readonly maxAttempts: number;
  readonly blockSeconds: number;
}

/**
 * 登录失败三层限流的候选基线。设计文档只规定“账号 + IP + 全局”，
 * 未冻结具体阈值、窗口与阻断时长；以下取值用于阶段 0 实现与测试，
 * 正式数值须由人工安全评审确认后再锁定。
 */
export const DEFAULT_LOGIN_RATE_LIMIT_RULES: readonly AuthRateLimitRule[] = [
  {
    bucketType: "GLOBAL",
    windowSeconds: 5 * 60,
    maxAttempts: 100,
    blockSeconds: 60,
  },
  {
    bucketType: "ACCOUNT",
    windowSeconds: 15 * 60,
    maxAttempts: 5,
    blockSeconds: 15 * 60,
  },
  {
    bucketType: "IP",
    windowSeconds: 15 * 60,
    maxAttempts: 20,
    blockSeconds: 15 * 60,
  },
] as const;

export function windowStartedAt(now: Date, windowSeconds: number): Date {
  const windowMillis = windowSeconds * 1000;
  const timestamp = Math.floor(now.getTime() / windowMillis) * windowMillis;
  return new Date(timestamp);
}

export function blockedUntil(now: Date, blockSeconds: number): Date {
  return new Date(now.getTime() + blockSeconds * 1000);
}

export function normalizeLoginName(loginName: string): string {
  return loginName.trim().toLowerCase();
}

export function normalizeClientIp(clientIp: string): string {
  const trimmed = clientIp.trim();
  const withoutV4MappedPrefix = trimmed.startsWith("::ffff:")
    ? trimmed.slice("::ffff:".length)
    : trimmed;
  return withoutV4MappedPrefix.length === 0
    ? "unknown"
    : withoutV4MappedPrefix.slice(0, 255);
}
