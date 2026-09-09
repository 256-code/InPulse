import { randomUUID } from "node:crypto";

import { Controller, Get, Req, Res } from "@nestjs/common";

import type { ActivityPath, ActivityQueryRequest } from "@inpulse/api-contract";
import {
  ContractPath,
  ContractQuery,
  Operation,
} from "../../http/contract.decorators.js";
import { SessionAuthService } from "../../auth/session-auth.service.js";
import { getHeader, type HttpHeaderBag } from "../../auth/csrf.http.js";
import {
  ActivityAuthorizationError,
  ActivityQueryService,
  ActivityQueryValidationError,
} from "./activity-query.service.js";

interface ActivityControllerRequest {
  readonly headers: HttpHeaderBag;
}

interface ActivityControllerResponse {
  status(code: number): unknown;
}

interface ErrorResponseDto {
  readonly code: string;
  readonly message: string;
  readonly details: Readonly<Record<string, string>>;
  readonly requestId: string;
}

/**
 * F-27 项目动态入口：先解析 Session，再让 ActivityQueryService 取得服务端
 * AuthorizedProjectScope；返回白名单时间线条目，不接受客户端授权范围。
 */
@Controller("projects")
export class ActivityController {
  constructor(
    private readonly sessionAuth: SessionAuthService,
    private readonly activityService: ActivityQueryService,
  ) {}

  @Get(":projectId/activity")
  @Operation("getProjectActivity")
  async list(
    @Req() request: ActivityControllerRequest,
    @Res({ passthrough: true }) response: ActivityControllerResponse,
    @ContractPath("getProjectActivity") params: ActivityPath,
    @ContractQuery("getProjectActivity") query: ActivityQueryRequest,
  ): Promise<unknown | ErrorResponseDto> {
    const requestId = randomUUID();
    const actor = await this.sessionAuth.resolveActor(
      getHeader(request.headers, "cookie"),
    );
    if (actor === undefined) {
      response.status(401);
      return {
        code: "ACTIVITY_UNAUTHENTICATED",
        message: "需要有效认证 Session 才能查看项目动态",
        details: {},
        requestId,
      };
    }

    try {
      const result = await this.activityService.query({
        actorUserId: actor.userId,
        projectId: params.projectId,
        ...(query.cursor === undefined ? {} : { after: query.cursor }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.includeAdminOnly === undefined
          ? {}
          : { includeAdminOnly: query.includeAdminOnly }),
      });
      return {
        items: result.items,
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
      };
    } catch (error) {
      if (error instanceof ActivityQueryValidationError) {
        response.status(422);
        return validationResponse(requestId, error.message);
      }
      if (error instanceof ActivityAuthorizationError) {
        response.status(404);
        return {
          code: "ACTIVITY_PROJECT_NOT_FOUND",
          message: "项目不存在或当前用户无权访问",
          details: {},
          requestId,
        };
      }
      response.status(500);
      return {
        code: "INTERNAL_ERROR",
        message: "服务器无法完成项目动态查询",
        details: {},
        requestId,
      };
    }
  }
}

function validationResponse(
  requestId: string,
  message: string,
): ErrorResponseDto {
  return {
    code: "ACTIVITY_VALIDATION_FAILED",
    message,
    details: {},
    requestId,
  };
}
