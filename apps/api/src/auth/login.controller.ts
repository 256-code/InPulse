import { randomUUID } from "node:crypto";

import { Body, Controller, HttpCode, Post, Req, Res } from "@nestjs/common";

import {
  buildCookie,
  getHeader,
  mutationSameOriginValidationError,
  type HttpHeaderBag,
} from "./csrf.http.js";
import { LoginError } from "./login.error.js";
import { LoginService } from "./login.service.js";

interface LoginControllerRequest {
  readonly headers: HttpHeaderBag;
  readonly body: unknown;
}

interface LoginControllerResponse {
  status(code: number): unknown;
  setHeader(name: string, value: string | readonly string[]): unknown;
}

interface LoginResponseDto {
  readonly csrfToken: string;
  readonly authState: string;
}

interface ErrorResponseDto {
  readonly code: string;
  readonly message: string;
  readonly details: Readonly<Record<string, string>>;
  readonly requestId: string;
}

interface LoginBodyDto {
  readonly loginName: string;
  readonly password: string;
}

function parseLoginBody(body: unknown): LoginBodyDto | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return undefined;
  }
  const record = body as Readonly<Record<string, unknown>>;
  const loginName = record["loginName"];
  const password = record["password"];
  if (typeof loginName !== "string" || typeof password !== "string") {
    return undefined;
  }
  const normalizedLoginName = loginName.trim();
  if (
    normalizedLoginName.length < 1 ||
    normalizedLoginName.length > 100 ||
    password.length < 1 ||
    password.length > 1024
  ) {
    return undefined;
  }
  return { loginName: normalizedLoginName, password };
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
  async login(
    @Req() request: LoginControllerRequest,
    @Res({ passthrough: true }) response: LoginControllerResponse,
    @Body() body: unknown,
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

    const parsed = parseLoginBody(body);
    if (parsed === undefined) {
      response.status(422);
      return {
        code: "LOGIN_VALIDATION_FAILED",
        message: "登录请求体格式或字段长度无效",
        details: {},
        requestId,
      };
    }

    try {
      const result = await this.loginService.login({
        loginName: parsed.loginName,
        password: parsed.password,
        cookieHeader: getHeader(request.headers, "cookie"),
        csrfToken: getHeader(request.headers, "x-csrf-token"),
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
