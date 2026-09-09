import { randomUUID } from "node:crypto";

import {
  Controller,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";

import {
  ContractBody,
  ContractHeaders,
  Operation,
} from "../http/contract.decorators.js";
import type { LoginHeaders, LoginRequest } from "@inpulse/api-contract";
import {
  buildCookie,
  getHeader,
  mutationSameOriginValidationError,
  type HttpHeaderBag,
} from "./csrf.http.js";
import { StrictSameOriginGuard } from "./csrf.guard.js";
import { normalizeClientIp } from "./auth-rate-limit.policy.js";
import { LoginError } from "./login.error.js";
import { LoginService } from "./login.service.js";

interface LoginControllerRequest {
  readonly headers: HttpHeaderBag;
  readonly body: unknown;
  readonly ip?: string;
  readonly socket?: { readonly remoteAddress?: string };
}

interface LoginControllerResponse {
  status(code: number): unknown;
  setHeader(name: string, value: string | readonly string[]): unknown;
}

interface LoginResponseDto {
  readonly csrfToken: string;
  readonly authState: string;
  readonly enrollmentGeneration?: number;
}

interface ErrorResponseDto {
  readonly code: string;
  readonly message: string;
  readonly details: Readonly<Record<string, string>>;
  readonly requestId: string;
}

function resolveClientIp(request: LoginControllerRequest): string {
  const raw =
    request.ip?.trim() || request.socket?.remoteAddress?.trim() || "unknown";
  return normalizeClientIp(raw);
}

/**
 * ADR-023 安全流程入口：POST /auth/login 只消费匿名预认证 Session + CSRF，
 * 成功后轮换 Cookie 并返回一次性认证 CSRF Token。所有错误使用统一信封。
 */
@Controller("auth")
export class LoginController {
  constructor(private readonly loginService: LoginService) {}

  @Post("login")
  @HttpCode(200)
  @UseGuards(StrictSameOriginGuard)
  @Operation("login")
  async login(
    @Req() request: LoginControllerRequest,
    @Res({ passthrough: true }) response: LoginControllerResponse,
    @ContractBody("login") body: LoginRequest,
    @ContractHeaders("login") headers: LoginHeaders,
  ): Promise<LoginResponseDto | ErrorResponseDto> {
    const requestId = randomUUID();
    const originFailure = mutationSameOriginValidationError(request.headers);
    if (originFailure !== undefined) {
      response.status(403);
      return {
        code: "CSRF_ORIGIN_REJECTED",
        message: "登录请求未通过同源或 Fetch Metadata 校验",
        details: { reason: originFailure },
        requestId,
      };
    }

    try {
      const result = await this.loginService.login({
        loginName: body.loginName,
        password: body.password,
        clientIp: resolveClientIp(request),
        cookieHeader: getHeader(request.headers, "cookie"),
        csrfToken: headers["x-csrf-token"],
        challengeMode: body.challengeMode,
      });
      response.setHeader(
        "Set-Cookie",
        result.cookies.map((cookie) => buildCookie(cookie)),
      );
      response.setHeader("Cache-Control", "no-store");
      response.status(200);
      return {
        csrfToken: result.csrfToken,
        authState: result.authState,
        ...(result.enrollmentGeneration === undefined
          ? {}
          : { enrollmentGeneration: result.enrollmentGeneration }),
      };
    } catch (error) {
      if (error instanceof LoginError) {
        response.status(error.status);
        return {
          code: error.code,
          message: error.message,
          details: { reason: error.reason },
          requestId,
        };
      }
      response.status(500);
      return {
        code: "INTERNAL_ERROR",
        message: "服务器无法完成登录",
        details: {},
        requestId,
      };
    }
  }
}
