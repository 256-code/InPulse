import { randomUUID } from "node:crypto";

import { Controller, Get, Req, Res } from "@nestjs/common";

import type {
  MyRecordDraftListQuery,
  MyRecordDraftPage,
} from "@inpulse/api-contract";

import { getHeader, type HttpHeaderBag } from "../../auth/csrf.http.js";
import { SessionAuthService } from "../../auth/session-auth.service.js";
import { ContractQuery, Operation } from "../../http/contract.decorators.js";
import { AggregateReadError } from "./aggregate-read.errors.js";
import { MyRecordDraftsQueryService } from "./my-record-drafts-query.service.js";

interface MyRecordDraftsControllerRequest {
  readonly headers: HttpHeaderBag;
}

interface MyRecordDraftsControllerResponse {
  status(code: number): unknown;
}

interface ErrorResponseDto {
  readonly code: string;
  readonly message: string;
  readonly details: Readonly<Record<string, string>>;
  readonly requestId: string;
}

/**
 * B-3b 我的草稿（listMyRecordDrafts）。只绑定 listMyRecordDrafts；作者恒为当前
 * 认证 actor，不接受任何他人身份或授权范围参数（因此不登记 403）；草稿仍按实时
 * AuthorizedProjectScope 过滤，被移出项目后立即不可见；游标无效或与接口不匹配
 * 统一 422。
 */
@Controller()
export class MyRecordDraftsController {
  constructor(
    private readonly sessionAuth: SessionAuthService,
    private readonly drafts: MyRecordDraftsQueryService,
  ) {}

  @Get("me/record-drafts")
  @Operation("listMyRecordDrafts")
  async listMyRecordDrafts(
    @Req() request: MyRecordDraftsControllerRequest,
    @Res({ passthrough: true }) response: MyRecordDraftsControllerResponse,
    @ContractQuery("listMyRecordDrafts") query: MyRecordDraftListQuery,
  ): Promise<MyRecordDraftPage | ErrorResponseDto> {
    const requestId = randomUUID();
    const actor = await this.sessionAuth.resolveActor(
      getHeader(request.headers, "cookie"),
    );
    if (actor === undefined) {
      response.status(401);
      return {
        code: "MY_RECORD_DRAFTS_UNAUTHENTICATED",
        message: "需要有效认证 Session 才能查看本人草稿",
        details: {},
        requestId,
      };
    }

    try {
      return await this.drafts.list({
        actorUserId: actor.userId,
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
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
        message: "服务器无法完成草稿查询",
        details: {},
        requestId,
      };
    }
  }
}
