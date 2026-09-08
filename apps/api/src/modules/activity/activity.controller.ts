import { randomUUID } from "node:crypto";

import { Controller, Get, Param, Query, Req, Res } from "@nestjs/common";

import {
  activityPathSchema,
  activityQueryRequestSchema,
} from "@inpulse/api-contract";
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
  async list(
    @Req() request: ActivityControllerRequest,
    @Res({ passthrough: true }) response: ActivityControllerResponse,
    @Param() params: unknown,
    @Query() query: unknown,
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

    const path = activityPathSchema.safeParse(params);
    if (!path.success) {
      response.status(422);
      return validationResponse(requestId, "项目 ID 无效");
    }
    const parsed = activityQueryRequestSchema.safeParse(query);
    if (!parsed.success) {
      response.status(422);
      return validationResponse(requestId, "项目动态查询参数无效");
    }

    try {
      const result = await this.activityService.query({
        actorUserId: actor.userId,
        projectId: path.data.projectId,
        ...(parsed.data.cursor === undefined
          ? {}
          : { after: parsed.data.cursor }),
        ...(parsed.data.limit === undefined
          ? {}
          : { limit: parsed.data.limit }),
        ...(parsed.data.includeAdminOnly === undefined
          ? {}
          : { includeAdminOnly: parsed.data.includeAdminOnly }),
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
