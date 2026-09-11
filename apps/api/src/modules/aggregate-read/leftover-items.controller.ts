import { randomUUID } from "node:crypto";

import { Controller, Get, Req, Res } from "@nestjs/common";

import type {
  LeftoverItemPage,
  LeftoverListQueryRequest,
} from "@inpulse/api-contract";

import { SessionAuthService } from "../../auth/session-auth.service.js";
import { getHeader, type HttpHeaderBag } from "../../auth/csrf.http.js";
import { ContractQuery, Operation } from "../../http/contract.decorators.js";
import { AggregateReadError } from "./aggregate-read.errors.js";
import { LeftoverItemsQueryService } from "./leftover-items-query.service.js";

interface LeftoverItemsControllerRequest {
  readonly headers: HttpHeaderBag;
}

interface LeftoverItemsControllerResponse {
  status(code: number): unknown;
}

interface ErrorResponseDto {
  readonly code: string;
  readonly message: string;
  readonly details: Readonly<Record<string, string>>;
  readonly requestId: string;
}

/**
 * F-20 遗留问题列表（R-6）。只绑定 listLeftoverItems；授权范围固定为服务端
 * AuthorizedProjectScope，projectId 只用于缩小范围，越权项目收敛为空页而不是
 * 404；游标无效或与筛选不匹配统一 422（聚合读统一语义）。
 */
@Controller()
export class LeftoverItemsController {
  constructor(
    private readonly sessionAuth: SessionAuthService,
    private readonly leftovers: LeftoverItemsQueryService,
  ) {}

  @Get("leftover-items")
  @Operation("listLeftoverItems")
  async listLeftoverItems(
    @Req() request: LeftoverItemsControllerRequest,
    @Res({ passthrough: true }) response: LeftoverItemsControllerResponse,
    @ContractQuery("listLeftoverItems") query: LeftoverListQueryRequest,
  ): Promise<LeftoverItemPage | ErrorResponseDto> {
    const requestId = randomUUID();
    const actor = await this.sessionAuth.resolveActor(
      getHeader(request.headers, "cookie"),
    );
    if (actor === undefined) {
      response.status(401);
      return {
        code: "LEFTOVER_ITEMS_UNAUTHENTICATED",
        message: "需要有效认证 Session 才能查看遗留问题",
        details: {},
        requestId,
      };
    }

    try {
      return await this.leftovers.list({
        actorUserId: actor.userId,
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.projectId === undefined
          ? {}
          : { projectId: query.projectId }),
        ...(query.bucket === undefined ? {} : { bucket: query.bucket }),
      });
    } catch (error) {
      if (error instanceof AggregateReadError) {
        response.status(error.status);
        return {
          code: error.code,
          message: error.message,
          details: {},
          requestId,
        };
      }
      response.status(500);
      return {
        code: "INTERNAL_ERROR",
        message: "服务器无法完成遗留问题查询",
        details: {},
        requestId,
      };
    }
  }
}
