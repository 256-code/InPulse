import { randomUUID } from "node:crypto";

import { Controller, Get, Req, Res } from "@nestjs/common";

import type { MyOrganizationMembersResponse } from "@inpulse/api-contract";

import { getHeader, type HttpHeaderBag } from "../auth/csrf.http.js";
import { Operation } from "../http/contract.decorators.js";
import { OrganizationMembersService } from "./organization-members.service.js";

interface OrganizationMembersControllerRequest {
  readonly headers: HttpHeaderBag;
}

interface OrganizationMembersControllerResponse {
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
 * ADR-081 同组织成员入口。身份由服务端从 __Host-session Cookie 解析，
 * 客户端不能传入组织 ID 或任何过滤条件。
 */
@Controller("organizations")
export class OrganizationMembersController {
  constructor(private readonly service: OrganizationMembersService) {}

  @Get("me/members")
  @Operation("getMyOrganizationMembers")
  async list(
    @Req() request: OrganizationMembersControllerRequest,
    @Res({ passthrough: true }) response: OrganizationMembersControllerResponse,
  ): Promise<MyOrganizationMembersResponse | ErrorResponseDto> {
    const requestId = randomUUID();
    response.setHeader("Cache-Control", "no-store");
    try {
      const result = await this.service.getMyMembers(
        getHeader(request.headers, "cookie"),
      );
      if (result === undefined) {
        response.status(401);
        return {
          code: "ORGANIZATION_SESSION_REQUIRED",
          message: "需要有效认证 Session 才能读取同组织成员",
          details: {},
          requestId,
        };
      }
      return result;
    } catch {
      response.status(500);
      return {
        code: "INTERNAL_ERROR",
        message: "服务器无法读取同组织成员",
        details: {},
        requestId,
      };
    }
  }
}
