import { randomUUID } from "node:crypto";

import { Controller, Get, Req, Res } from "@nestjs/common";

import type {
  TaskGroupMembershipQueryRequest,
  TaskGroupMembershipResponse,
} from "@inpulse/api-contract";

import { SessionAuthService } from "../../auth/session-auth.service.js";
import { getHeader, type HttpHeaderBag } from "../../auth/csrf.http.js";
import { ContractQuery, Operation } from "../../http/contract.decorators.js";
import { AggregateReadError } from "./aggregate-read.errors.js";
import { TaskGroupMembershipQueryService } from "./task-group-membership-query.service.js";

interface TaskGroupMembershipControllerRequest {
  readonly headers: HttpHeaderBag;
}

interface TaskGroupMembershipControllerResponse {
  status(code: number): unknown;
}

interface ErrorResponseDto {
  readonly code: string;
  readonly message: string;
  readonly details: Readonly<Record<string, string>>;
  readonly requestId: string;
}

/**
 * F-25 任务卡片聚合关系批量查询（R-5）。
 *
 * 只绑定 listTaskGroupMemberships；taskIds 由契约层解析逗号分隔列表并校验
 * 数量、格式与重复（422），服务层只返回当前用户有权访问项目且属于 ACTIVE
 * 聚合组的任务，无权或不存在一律不入结果（不返回 404）。
 *
 * 路由顺序：GET /task-groups/memberships 必须注册在 TaskGroupReadController 的
 * GET /task-groups/{groupId} 之前，否则会被参数路由吞掉；由 AggregateReadModule
 * 的 controllers 顺序保证，并由集成测试断言实际路由解析。
 */
@Controller("task-groups")
export class TaskGroupMembershipController {
  constructor(
    private readonly sessionAuth: SessionAuthService,
    private readonly memberships: TaskGroupMembershipQueryService,
  ) {}

  @Get("memberships")
  @Operation("listTaskGroupMemberships")
  async listTaskGroupMemberships(
    @Req() request: TaskGroupMembershipControllerRequest,
    @Res({ passthrough: true })
    response: TaskGroupMembershipControllerResponse,
    @ContractQuery("listTaskGroupMemberships")
    query: TaskGroupMembershipQueryRequest,
  ): Promise<TaskGroupMembershipResponse | ErrorResponseDto> {
    const requestId = randomUUID();
    const actor = await this.sessionAuth.resolveActor(
      getHeader(request.headers, "cookie"),
    );
    if (actor === undefined) {
      response.status(401);
      return {
        code: "TASK_GROUP_MEMBERSHIP_UNAUTHENTICATED",
        message: "需要有效认证 Session 才能查询任务聚合关系",
        details: {},
        requestId,
      };
    }

    try {
      return await this.memberships.list({
        actorUserId: actor.userId,
        taskIds: query.taskIds,
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
        message: "服务器无法完成任务聚合关系查询",
        details: {},
        requestId,
      };
    }
  }
}
