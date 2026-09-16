import type { CsrfSetCookie } from "../csrf.http.js";
import { normalizeReturnTo } from "./sso-return-to.js";

export interface SsoStartInput {
  readonly returnTo: string | undefined;
}

export interface SsoStartResult {
  readonly location: string;
  readonly cookies: readonly CsrfSetCookie[];
}

export interface SsoCompleteInput {
  readonly code: string | undefined;
  readonly state: string | undefined;
  readonly error: string | undefined;
  readonly cookieHeader: string | undefined;
  readonly clientIp: string;
  readonly requestId: string;
  readonly userAgent: string | null;
}

export interface SsoCompleteResult {
  readonly location: string;
  readonly cookies: readonly CsrfSetCookie[];
}

/**
 * 未配置 SSO 时未启用的回退目标（ADR-032：fail closed 并回落本地入口）。
 * start 带上规范化后的站内回跳目标，避免禁用路径丢失登录前的访问意图。
 */
export function ssoDisabledLocation(returnTo?: string): string {
  const target = normalizeReturnTo(returnTo);
  if (target === null || target === "/") {
    return "/login?local=1&sso=disabled";
  }
  return `/login?local=1&sso=disabled&from=${encodeURIComponent(target)}`;
}

export function loginErrorLocation(reason: string): string {
  return `/login?sso_error=${encodeURIComponent(reason)}`;
}

/**
 * SSO 网关边界。`SSO_ENABLED` 未开启或配置非法时装配 DisabledSsoGateway，
 * Controller 必须先检查 `enabled`，不得调用禁用实现。
 */
export abstract class SsoGateway {
  abstract readonly enabled: boolean;
  abstract start(input: SsoStartInput): Promise<SsoStartResult>;
  abstract complete(input: SsoCompleteInput): Promise<SsoCompleteResult>;
}

export class DisabledSsoGateway extends SsoGateway {
  readonly enabled = false;

  start(): Promise<SsoStartResult> {
    return Promise.reject(new Error("SSO is not configured"));
  }

  complete(): Promise<SsoCompleteResult> {
    return Promise.reject(new Error("SSO is not configured"));
  }
}
