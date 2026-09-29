import { randomUUID } from "node:crypto";

import { Controller, Get, Req, Res } from "@nestjs/common";

import type {
  RecordSummaryQueryRequest,
  RecordSummaryResponse,
} from "@inpulse/api-contract";

import { SessionAuthService } from "../../auth/session-auth.service.js";
import { getHeader, type HttpHeaderBag } from "../../auth/csrf.http.js";
import { ContractQuery, Operation } from "../../http/contract.decorators.js";
import { AggregateReadError } from "./aggregate-read.errors.js";
import { RecordSummaryQueryService } from "./record-summary-query.service.js";

interface RecordSummaryControllerRequest {
  readonly headers: HttpHeaderBag;
}

interface RecordSummaryControllerResponse {
  status(code: number): unknown;
}

interface ErrorResponseDto {
  readonly code: string;
  readonly message: string;
  readonly details: Readonly<Record<string, string>>;
  readonly requestId: string;
}

/**
 * F-33 迭代总结（getRecordSummary）。只绑定 getRecordSummary；授权范围固定为
 * 服务端 AuthorizedProjectScope，projectId / memberId 只用于缩小范围，越权项目
 * 收敛为空集而不是 404；日期跨度或 groupBy 非法由契约层统一返回 422。
 */
@Controller()
export class RecordSummaryController {
  constructor(
    private readonly sessionAuth: SessionAuthService,
    private readonly summary: RecordSummaryQueryService,
  ) {}

  @Get("change-records/summary")
  @Operation("getRecordSummary")
  async getRecordSummary(
    @Req() request: RecordSummaryControllerRequest,
    @Res({ passthrough: true }) response: RecordSummaryControllerResponse,
    @ContractQuery("getRecordSummary") query: RecordSummaryQueryRequest,
  ): Promise<RecordSummaryResponse | ErrorResponseDto> {
    const requestId = randomUUID();
    const actor = await this.sessionAuth.resolveActor(
      getHeader(request.headers, "cookie"),
    );
    if (actor === undefined) {
      response.status(401);
      return {
        code: "RECORD_SUMMARY_UNAUTHENTICATED",
        message: "需要有效认证 Session 才能生成迭代总结",
        details: {},
        requestId,
      };
    }

    try {
      return await this.summary.get({
        actorUserId: actor.userId,
        fromDate: query.from,
        toDate: query.to,
        groupBy: query.groupBy,
        ...(query.projectId === undefined
          ? {}
          : { projectId: query.projectId }),
        ...(query.memberId === undefined ? {} : { memberId: query.memberId }),
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
        message: "服务器无法完成迭代总结",
        details: {},
        requestId,
      };
    }
  }
}
