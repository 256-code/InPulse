import { randomUUID } from "node:crypto";

import { Controller, Get, Req, Res } from "@nestjs/common";

import {
  buildCookie,
  getHeader,
  sameOriginValidationError,
  type HttpHeaderBag,
} from "./csrf.http.js";
import { CsrfIssueService } from "./csrf-issue.service.js";

interface CsrfControllerRequest {
  readonly headers: HttpHeaderBag;
}

interface CsrfControllerResponse {
  status(code: number): unknown;
  setHeader(name: string, value: string | readonly string[]): unknown;
}

interface CsrfIssueResponseDto {
  readonly csrfToken: string;
}

interface ErrorResponseDto {
  readonly code: string;
  readonly message: string;
  readonly details: Readonly<Record<string, string>>;
  readonly requestId: string;
}

/**
 * ADR-023 安全流程入口：GET /auth/csrf 只创建一次性安全材料，
 * 不执行业务命令；响应与 Cookie 均禁止缓存。
 */
@Controller("auth")
export class CsrfController {
  constructor(private readonly csrfIssueService: CsrfIssueService) {}

  @Get("csrf")
  async issue(
    @Req() request: CsrfControllerRequest,
    @Res({ passthrough: true }) response: CsrfControllerResponse,
  ): Promise<CsrfIssueResponseDto | ErrorResponseDto> {
    const originFailure = sameOriginValidationError(request.headers);
    if (originFailure !== undefined) {
      response.status(403);
      return {
        code: "CSRF_ORIGIN_REJECTED",
        message: "CSRF 签发请求未通过同源或 Fetch Metadata 校验",
        details: { reason: originFailure },
        requestId: randomUUID(),
      };
    }

    try {
      const result = await this.csrfIssueService.issue({
        cookieHeader: getHeader(request.headers, "cookie"),
      });
      response.setHeader(
        "Set-Cookie",
        result.cookies.map((cookie) => buildCookie(cookie)),
      );
      response.setHeader("Cache-Control", "no-store");
      return { csrfToken: result.csrfToken };
    } catch {
      response.status(500);
      return {
        code: "INTERNAL_ERROR",
        message: "服务器无法签发 CSRF Token",
        details: {},
        requestId: randomUUID(),
      };
    }
  }
}
