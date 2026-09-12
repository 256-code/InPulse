import { randomUUID } from "node:crypto";

import { Controller, Get, Req, Res } from "@nestjs/common";

import type {
  RecordFeedPage,
  RecordFeedQueryRequest,
} from "@inpulse/api-contract";

import { getHeader, type HttpHeaderBag } from "../../auth/csrf.http.js";
import { SessionAuthService } from "../../auth/session-auth.service.js";
import { ContractQuery, Operation } from "../../http/contract.decorators.js";
import { AggregateReadError } from "./aggregate-read.errors.js";
import { RecordFeedQueryService } from "./record-feed-query.service.js";

interface RecordFeedControllerRequest {
  readonly headers: HttpHeaderBag;
}

interface RecordFeedControllerResponse {
  status(code: number): unknown;
}

interface ErrorResponseDto {
  readonly code: string;
  readonly message: string;
  readonly details: Readonly<Record<string, string>>;
  readonly requestId: string;
}

/**
 * B-3b 跨项目记录清单（listRecordFeed）。只绑定 listRecordFeed；授权范围固定为
 * 服务端 AuthorizedProjectScope，projectId 只用于缩小范围，越权项目收敛为空页
 * 而不是 404；status=VOID / ALL 的作废行只对系统管理员可见，非管理员收敛为
 * PUBLISHED 行而不是 403；游标无效、与筛选不匹配或 q 归一化后不足 2 字统一 422。
 */
@Controller()
export class RecordFeedController {
  constructor(
    private readonly sessionAuth: SessionAuthService,
    private readonly feed: RecordFeedQueryService,
  ) {}

  @Get("change-records")
  @Operation("listRecordFeed")
  async listRecordFeed(
    @Req() request: RecordFeedControllerRequest,
    @Res({ passthrough: true }) response: RecordFeedControllerResponse,
    @ContractQuery("listRecordFeed") query: RecordFeedQueryRequest,
  ): Promise<RecordFeedPage | ErrorResponseDto> {
    const requestId = randomUUID();
    const actor = await this.sessionAuth.resolveActor(
      getHeader(request.headers, "cookie"),
    );
    if (actor === undefined) {
      response.status(401);
      return {
        code: "RECORD_FEED_UNAUTHENTICATED",
        message: "需要有效认证 Session 才能查看迭代记录",
        details: {},
        requestId,
      };
    }

    try {
      return await this.feed.list({
        actorUserId: actor.userId,
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.projectId === undefined
          ? {}
          : { projectId: query.projectId }),
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.source === undefined ? {} : { source: query.source }),
        ...(query.q === undefined ? {} : { q: query.q }),
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
        message: "服务器无法完成迭代记录查询",
        details: {},
        requestId,
      };
    }
  }
}
