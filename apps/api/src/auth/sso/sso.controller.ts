import { randomUUID } from "node:crypto";

import { Controller, Get, Inject, Req, Res } from "@nestjs/common";

import type {
  SsoCallbackQueryRequest,
  SsoStartQueryRequest,
} from "@inpulse/api-contract";
import { ContractQuery, Operation } from "../../http/contract.decorators.js";
import { normalizeClientIp } from "../auth-rate-limit.policy.js";
import {
  buildCookie,
  getHeader,
  type CsrfSetCookie,
  type HttpHeaderBag,
} from "../csrf.http.js";
import {
  SsoGateway,
  loginErrorLocation,
  ssoDisabledLocation,
} from "./sso-gateway.js";

interface SsoControllerRequest {
  readonly headers: HttpHeaderBag;
  readonly ip?: string;
  readonly socket?: { readonly remoteAddress?: string };
}

interface SsoControllerResponse {
  status(code: number): unknown;
  setHeader(name: string, value: string | readonly string[]): unknown;
}

function resolveClientIp(request: SsoControllerRequest): string {
  const raw =
    request.ip?.trim() || request.socket?.remoteAddress?.trim() || "unknown";
  return normalizeClientIp(raw);
}

function resolveUserAgent(request: SsoControllerRequest): string | null {
  return getHeader(request.headers, "user-agent")?.slice(0, 512) ?? null;
}

function applyRedirect(
  response: SsoControllerResponse,
  location: string,
  cookies: readonly CsrfSetCookie[],
): void {
  response.status(302);
  response.setHeader("Location", location);
  response.setHeader("Cache-Control", "no-store");
  if (cookies.length > 0) {
    response.setHeader(
      "Set-Cookie",
      cookies.map((cookie) => buildCookie(cookie)),
    );
  }
}

/**
 * ADR-032 认证导航入口：两条 GET 路由都只做 302，不返回 JSON 响应体，
 * 因此不登记任何 2xx 状态，也不参与生成客户端；安全材料只经 Cookie 传递。
 * 未配置 SSO 时 start 直接回落 `/login?local=1&sso=disabled`，fail closed。
 */
@Controller("auth/sso")
export class SsoController {
  constructor(@Inject(SsoGateway) private readonly gateway: SsoGateway) {}

  @Get("start")
  @Operation("startSsoLogin")
  async start(
    @Req() _request: SsoControllerRequest,
    @Res({ passthrough: true }) response: SsoControllerResponse,
    @ContractQuery("startSsoLogin") query: SsoStartQueryRequest,
  ): Promise<void> {
    if (!this.gateway.enabled) {
      applyRedirect(response, ssoDisabledLocation(query.returnTo), []);
      return;
    }
    try {
      const result = await this.gateway.start({ returnTo: query.returnTo });
      applyRedirect(response, result.location, result.cookies);
    } catch {
      applyRedirect(response, loginErrorLocation("internal"), []);
    }
  }

  @Get("callback")
  @Operation("completeSsoLogin")
  async callback(
    @Req() request: SsoControllerRequest,
    @Res({ passthrough: true }) response: SsoControllerResponse,
    @ContractQuery("completeSsoLogin") query: SsoCallbackQueryRequest,
  ): Promise<void> {
    if (!this.gateway.enabled) {
      applyRedirect(response, ssoDisabledLocation(), []);
      return;
    }
    try {
      const result = await this.gateway.complete({
        code: query.code,
        state: query.state,
        error: query.error,
        cookieHeader: getHeader(request.headers, "cookie"),
        clientIp: resolveClientIp(request),
        requestId: randomUUID(),
        userAgent: resolveUserAgent(request),
      });
      applyRedirect(response, result.location, result.cookies);
    } catch {
      applyRedirect(response, loginErrorLocation("internal"), []);
    }
  }
}
