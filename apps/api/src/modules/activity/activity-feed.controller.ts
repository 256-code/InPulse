import { randomUUID } from "node:crypto";

import { Controller, Get, Req, Res } from "@nestjs/common";

import type {
  ActivityFeedQueryRequest,
  ActivityPage,
} from "@inpulse/api-contract";
import { ContractQuery, Operation } from "../../http/contract.decorators.js";
import { SessionAuthService } from "../../auth/session-auth.service.js";
import { getHeader, type HttpHeaderBag } from "../../auth/csrf.http.js";
import {
  ActivityQueryService,
  ActivityQueryValidationError,
} from "./activity-query.service.js";

interface ActivityFeedControllerRequest {
  readonly headers: HttpHeaderBag;
}

interface ActivityFeedControllerResponse {
  status(code: number): unknown;
}

interface ErrorResponseDto {
  readonly code: string;
  readonly message: string;
  readonly details: Readonly<Record<string, string>>;
  readonly requestId: string;
}

/**
 * 跨项目聚合动态（listActivity, GET /api/v1/activity）。
 *
 * 服务端把实时 AuthorizedProjectScope 与全部已删除项目的公开动态链合并到单一
 * 结果集，按 (occurred_at, id) 全局游标分页，「加载更多」只会追加更早的条目；
 * projectIds 只收窄范围，越权或未知项目静默排除，因此不存在 404 分支。
 * dayTotals 与列表同一过滤条件、按全量统计，不随分页增长（见 ADR-052 与
 * docs/permissions.md）。
 */
@Controller()
export class ActivityFeedController {
  constructor(
    private readonly sessionAuth: SessionAuthService,
    private readonly activityService: ActivityQueryService,
  ) {}

  @Get("activity")
  @Operation("listActivity")
  async listActivity(
    @Req() request: ActivityFeedControllerRequest,
    @Res({ passthrough: true }) response: ActivityFeedControllerResponse,
    @ContractQuery("listActivity") query: ActivityFeedQueryRequest,
  ): Promise<ActivityPage | ErrorResponseDto> {
    const requestId = randomUUID();
    const actor = await this.sessionAuth.resolveActor(
      getHeader(request.headers, "cookie"),
    );
    if (actor === undefined) {
      response.status(401);
      return {
        code: "ACTIVITY_UNAUTHENTICATED",
        message: "需要有效认证 Session 才能查看动态",
        details: {},
        requestId,
      };
    }

    try {
      const result = await this.activityService.listFeed({
        actorUserId: actor.userId,
        ...(query.projectIds === undefined
          ? {}
          : { projectIds: query.projectIds }),
        ...(query.cursor === undefined ? {} : { after: query.cursor }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.includeAdminOnly === undefined
          ? {}
          : { includeAdminOnly: query.includeAdminOnly }),
        ...(query.category === undefined ? {} : { category: query.category }),
      });
      return {
        items: [...result.items],
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
        dayTotals: [...result.dayTotals],
        dayTotalsTruncated: result.dayTotalsTruncated,
      };
    } catch (error) {
      if (error instanceof ActivityQueryValidationError) {
        response.status(422);
        return {
          code: "ACTIVITY_VALIDATION_FAILED",
          message: error.message,
          details: {},
          requestId,
        };
      }
      response.status(500);
      return {
        code: "INTERNAL_ERROR",
        message: "服务器无法完成动态查询",
        details: {},
        requestId,
      };
    }
  }
}
