import { randomUUID } from "node:crypto";

import { Controller, Get, Req, Res } from "@nestjs/common";

import { getHeader, type HttpHeaderBag } from "./csrf.http.js";
import { MeService } from "./me.service.js";
import type { CurrentUserProfile } from "./user-profile.repository.js";

interface MeControllerRequest {
  readonly headers: HttpHeaderBag;
}

interface MeControllerResponse {
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
 * GET /me：返回当前认证用户的公开资料。身份由服务端从
 * `__Host-session` Cookie 解析，客户端不能传入 userId。
 */
@Controller()
export class MeController {
  constructor(private readonly meService: MeService) {}

  @Get("me")
  async getCurrentUser(
    @Req() request: MeControllerRequest,
    @Res({ passthrough: true }) response: MeControllerResponse,
  ): Promise<CurrentUserProfile | ErrorResponseDto> {
    const requestId = randomUUID();
    try {
      const profile = await this.meService.getCurrentUser(
        getHeader(request.headers, "cookie"),
      );
      response.setHeader("Cache-Control", "no-store");
      if (profile === undefined) {
        response.status(401);
        return {
          code: "UNAUTHENTICATED",
          message: "登录状态无效或已过期",
          details: {},
          requestId,
        };
      }
      return profile;
    } catch {
      response.status(500);
      return {
        code: "INTERNAL_ERROR",
        message: "服务器无法读取当前用户",
        details: {},
        requestId,
      };
    }
  }
}
