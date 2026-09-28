import { randomUUID } from "node:crypto";

import { Controller, Get, Inject, Req, Res } from "@nestjs/common";

import type {
  ProjectDeletionPage,
  ProjectDeletionQueryRequest,
} from "@inpulse/api-contract";
import { getHeader, type HttpHeaderBag } from "../../auth/csrf.http.js";
import { SessionAuthService } from "../../auth/session-auth.service.js";
import { ContractQuery, Operation } from "../../http/contract.decorators.js";
import {
  ProjectDeletionQueryValidationError,
  ProjectDeletionsQueryService,
} from "./project-deletions.query.service.js";

interface ProjectDeletionsControllerRequest {
  readonly headers: HttpHeaderBag;
}

interface ProjectDeletionsControllerResponse {
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
 * ADR-050 项目删除记录入口：只要求有效 Session（任何登录用户，含没有项目
 * 访问权的用户），不接受客户端传入授权范围；返回内容只有删除台账本身。
 */
@Controller("project-deletions")
export class ProjectDeletionsController {
  constructor(
    @Inject(SessionAuthService) private readonly auth: SessionAuthService,
    @Inject(ProjectDeletionsQueryService)
    private readonly service: ProjectDeletionsQueryService,
  ) {}

  @Get()
  @Operation("listProjectDeletions")
  async list(
    @Req() request: ProjectDeletionsControllerRequest,
    @Res({ passthrough: true }) response: ProjectDeletionsControllerResponse,
    @ContractQuery("listProjectDeletions") query: ProjectDeletionQueryRequest,
  ): Promise<ProjectDeletionPage | ErrorResponseDto> {
    const requestId = randomUUID();
    response.setHeader("Cache-Control", "no-store");
    const actor = await this.auth.resolveActor(
      getHeader(request.headers, "cookie"),
    );
    if (actor === undefined) {
      response.status(401);
      response.setHeader("X-Request-Id", requestId);
      return {
        code: "PROJECT_SESSION_REQUIRED",
        message: "需要有效认证 Session 才能读取项目删除记录",
        details: {},
        requestId,
      };
    }

    try {
      return await this.service.query({
        actorUserId: actor.userId,
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.cursor === undefined ? {} : { after: query.cursor }),
      });
    } catch (error) {
      if (error instanceof ProjectDeletionQueryValidationError) {
        response.status(422);
        response.setHeader("X-Request-Id", requestId);
        return {
          code: "PROJECT_DELETION_VALIDATION_FAILED",
          message: error.message,
          details: {},
          requestId,
        };
      }
      response.status(500);
      response.setHeader("X-Request-Id", requestId);
      return {
        code: "INTERNAL_ERROR",
        message: "服务器无法读取项目删除记录",
        details: {},
        requestId,
      };
    }
  }
}
