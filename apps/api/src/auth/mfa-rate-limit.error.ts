export const MFA_RATE_LIMIT_CODE = "MFA_VERIFY_RATE_LIMITED" as const;
export const MFA_RATE_LIMIT_REASON = "mfa-rate-limited" as const;

/** MFA TOTP/恢复码验证达到持久化三层限流阈值。 */
export class MfaRateLimitError extends Error {
  readonly status: 429;
  readonly code: typeof MFA_RATE_LIMIT_CODE;
  readonly reason: typeof MFA_RATE_LIMIT_REASON;

  constructor() {
    super("MFA 验证失败次数过多，请稍后再试");
    this.name = "MfaRateLimitError";
    this.status = 429;
    this.code = MFA_RATE_LIMIT_CODE;
    this.reason = MFA_RATE_LIMIT_REASON;
  }
}

export function mfaRateLimited(): MfaRateLimitError {
  return new MfaRateLimitError();
}
