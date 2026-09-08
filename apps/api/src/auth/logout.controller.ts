import { randomUUID } from "node:crypto";

import { Controller, Post, Req, Res } from "@nestjs/common";

import {
  buildCookie,
  getHeader,
  mutationSameOriginValidationError,
  type HttpHeaderBag,
} from "./csrf.http.js";
import { LogoutError } from "./logout.error.js";
import { LogoutService } from "./logout.service.js";

interface LogoutControllerRequest {
  readonly headers: HttpHeaderBag;
}

interface LogoutControllerResponse {
  status(code: number): unknown;
  setHeader(name: string, value: string | readonly string[]): unknown;
}

interface ErrorResponseDto {
  readonly code: string;
  readonly message: string;
  readonly details: Readonly<Record<string, string>>;
  readonly requestId: string;
}

/**
 * ADR-015/ADR-023 安全流程入口：POST /auth/logout 在有效 Session 下验证并
 * 撤销 Session，否则按同源安全语义清 Cookie；统一返回 204。
 */
@Controller("auth")
export class LogoutController {
  constructor(private readonly logoutService: LogoutService) {}

  @Post("logout")
  async logout(
    @Req() request: LogoutControllerRequest,
    @Res({ passthrough: true }) response: LogoutControllerResponse,
  ): Promise<void | ErrorResponseDto> {
    const requestId = randomUUID();
    const originFailure = mutationSameOriginValidationError(request.headers);
    if (originFailure !== undefined) {
      response.status(403);
      return {
        code: "CSRF_ORIGIN_REJECTED",
        message: "登出请求未通过同源或 Fetch Metadata 校验",
        details: { reason: originFailure },
        requestId,
      };
    }

    try {
      const result = await this.logoutService.logout({
        cookieHeader: getHeader(request.headers, "cookie"),
        csrfToken: getHeader(request.headers, "x-csrf-token"),
      });
      response.status(204);
      response.setHeader(
        "Set-Cookie",
        result.cookies.map((cookie) => buildCookie(cookie)),
      );
      response.setHeader("Cache-Control", "no-store");
      return undefined;
    } catch (error) {
      if (error instanceof LogoutError) {
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
        message: "服务器无法完成登出",
        details: {},
        requestId,
      };
    }
  }
}
