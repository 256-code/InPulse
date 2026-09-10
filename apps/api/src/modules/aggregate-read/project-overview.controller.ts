import { randomUUID } from "node:crypto";

import { Controller, Get, Req, Res } from "@nestjs/common";

import type {
  ProjectOverviewQueryRequest,
  ProjectOverviewResponse,
  ProjectPath,
} from "@inpulse/api-contract";

import { SessionAuthService } from "../../auth/session-auth.service.js";
import { getHeader, type HttpHeaderBag } from "../../auth/csrf.http.js";
import {
  ContractPath,
  ContractQuery,
  Operation,
} from "../../http/contract.decorators.js";
import { AggregateReadError } from "./aggregate-read.errors.js";
import { ProjectOverviewQueryService } from "./project-overview-query.service.js";

interface ProjectOverviewControllerRequest {
  readonly headers: HttpHeaderBag;
}

interface ProjectOverviewControllerResponse {
  status(code: number): unknown;
}

interface ErrorResponseDto {
  readonly code: string;
  readonly message: string;
  readonly details: Readonly<Record<string, string>>;
  readonly requestId: string;
}

/**
 * F-29 项目概览（R-2）。只绑定 getProjectOverview，先解析 Session 再由服务层
 * 取得服务端 AuthorizedProjectScope；非成员与项目不存在统一 404，
 * 列表条数越界由契约层 422，统计口径全部在服务端聚合，前端不得逐项目请求。
 */
@Controller("projects")
export class ProjectOverviewController {
  constructor(
    private readonly sessionAuth: SessionAuthService,
    private readonly overview: ProjectOverviewQueryService,
  ) {}

  @Get(":projectId/overview")
  @Operation("getProjectOverview")
  async getProjectOverview(
    @Req() request: ProjectOverviewControllerRequest,
    @Res({ passthrough: true }) response: ProjectOverviewControllerResponse,
    @ContractPath("getProjectOverview") params: ProjectPath,
    @ContractQuery("getProjectOverview") query: ProjectOverviewQueryRequest,
  ): Promise<ProjectOverviewResponse | ErrorResponseDto> {
    const requestId = randomUUID();
    const actor = await this.sessionAuth.resolveActor(
      getHeader(request.headers, "cookie"),
    );
    if (actor === undefined) {
      response.status(401);
      return {
        code: "PROJECT_OVERVIEW_UNAUTHENTICATED",
        message: "需要有效认证 Session 才能查看项目概览",
        details: {},
        requestId,
      };
    }

    try {
      return await this.overview.getOverview({
        actorUserId: actor.userId,
        projectId: params.projectId,
        ...(query.recentRecordLimit === undefined
          ? {}
          : { recentRecordLimit: query.recentRecordLimit }),
        ...(query.activeLeftoverLimit === undefined
          ? {}
          : { activeLeftoverLimit: query.activeLeftoverLimit }),
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
        message: "服务器无法完成项目概览查询",
        details: {},
        requestId,
      };
    }
  }
}
