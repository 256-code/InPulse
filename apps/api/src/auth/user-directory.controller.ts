import { randomUUID } from "node:crypto";

import { Controller, Get, Req, Res } from "@nestjs/common";

import type { UserDirectoryResponse } from "@inpulse/api-contract";

import { getHeader, type HttpHeaderBag } from "./csrf.http.js";
import { UserDirectoryService } from "./user-directory.service.js";

interface UserDirectoryControllerRequest {
  readonly headers: HttpHeaderBag;
}

interface UserDirectoryControllerResponse {
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
 * 成员选择用户目录入口。身份由服务端从 `__Host-session` Cookie 解析，
 * 客户端不能传入过滤条件、用户 ID 或权限范围。
 */
@Controller("users")
export class UserDirectoryController {
  constructor(private readonly service: UserDirectoryService) {}

  @Get()
  async list(
    @Req() request: UserDirectoryControllerRequest,
    @Res({ passthrough: true }) response: UserDirectoryControllerResponse,
  ): Promise<UserDirectoryResponse | ErrorResponseDto> {
    const requestId = randomUUID();
    response.setHeader("Cache-Control", "no-store");
    try {
      const items = await this.service.getDirectory(
        getHeader(request.headers, "cookie"),
      );
      if (items === undefined) {
        response.status(401);
        return {
          code: "USER_DIRECTORY_UNAUTHENTICATED",
          message: "需要有效认证 Session 才能读取用户目录",
          details: {},
          requestId,
        };
      }
      return { items: [...items] };
    } catch {
      response.status(500);
      return {
        code: "INTERNAL_ERROR",
        message: "服务器无法读取用户目录",
        details: {},
        requestId,
      };
    }
  }
}
