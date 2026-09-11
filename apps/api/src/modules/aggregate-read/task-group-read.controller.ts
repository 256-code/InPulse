import { randomUUID } from "node:crypto";

import { Controller, Get, Req, Res } from "@nestjs/common";

import type {
  TaskGroupDetailResponse,
  TaskGroupListPage,
  TaskGroupListQueryRequest,
  TaskGroupPath,
  TaskGroupRecordPage,
  TaskGroupRecordQueryRequest,
} from "@inpulse/api-contract";

import { SessionAuthService } from "../../auth/session-auth.service.js";
import { getHeader, type HttpHeaderBag } from "../../auth/csrf.http.js";
import {
  ContractPath,
  ContractQuery,
  Operation,
} from "../../http/contract.decorators.js";
import { AggregateReadError } from "./aggregate-read.errors.js";
import { TaskGroupQueryService } from "./task-group-query.service.js";

interface TaskGroupControllerRequest {
  readonly headers: HttpHeaderBag;
}

interface TaskGroupControllerResponse {
  status(code: number): unknown;
}

interface ErrorResponseDto {
  readonly code: string;
  readonly message: string;
  readonly details: Readonly<Record<string, string>>;
  readonly requestId: string;
}

/**
 * F-25 聚合组视图（R-1）与聚合组记录列表（R-4）。
 *
 * 只绑定 Route Registry 的 getTaskGroup / listTaskGroups / listTaskGroupRecords，
 * 先解析 Session
 * 再由服务层取得服务端 AuthorizedProjectScope；非成员与不存在统一 404，
 * 游标或筛选非法统一 422，均不向客户端泄露资源存在性。
 */
@Controller("task-groups")
export class TaskGroupReadController {
  constructor(
    private readonly sessionAuth: SessionAuthService,
    private readonly taskGroups: TaskGroupQueryService,
  ) {}

  @Get(":groupId")
  @Operation("getTaskGroup")
  async getTaskGroup(
    @Req() request: TaskGroupControllerRequest,
    @Res({ passthrough: true }) response: TaskGroupControllerResponse,
    @ContractPath("getTaskGroup") params: TaskGroupPath,
  ): Promise<TaskGroupDetailResponse | ErrorResponseDto> {
    const requestId = randomUUID();
    const actor = await this.sessionAuth.resolveActor(
      getHeader(request.headers, "cookie"),
    );
    if (actor === undefined) {
      response.status(401);
      return {
        code: "TASK_GROUP_UNAUTHENTICATED",
        message: "需要有效认证 Session 才能查看任务聚合组",
        details: {},
        requestId,
      };
    }

    try {
      return await this.taskGroups.getTaskGroup({
        actorUserId: actor.userId,
        groupId: params.groupId,
      });
    } catch (error) {
      return this.toErrorResponse(error, response, requestId, "查看任务聚合组");
    }
  }

  @Get(":groupId/records")
  @Operation("listTaskGroupRecords")
  async listTaskGroupRecords(
    @Req() request: TaskGroupControllerRequest,
    @Res({ passthrough: true }) response: TaskGroupControllerResponse,
    @ContractPath("listTaskGroupRecords") params: TaskGroupPath,
    @ContractQuery("listTaskGroupRecords") query: TaskGroupRecordQueryRequest,
  ): Promise<TaskGroupRecordPage | ErrorResponseDto> {
    const requestId = randomUUID();
    const actor = await this.sessionAuth.resolveActor(
      getHeader(request.headers, "cookie"),
    );
    if (actor === undefined) {
      response.status(401);
      return {
        code: "TASK_GROUP_UNAUTHENTICATED",
        message: "需要有效认证 Session 才能查看聚合组记录",
        details: {},
        requestId,
      };
    }

    try {
      return await this.taskGroups.listTaskGroupRecords({
        actorUserId: actor.userId,
        groupId: params.groupId,
        ...(query.memberTaskId === undefined
          ? {}
          : { memberTaskId: query.memberTaskId }),
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
      });
    } catch (error) {
      return this.toErrorResponse(error, response, requestId, "查看聚合组记录");
    }
  }

  @Get()
  @Operation("listTaskGroups")
  async listTaskGroups(
    @Req() request: TaskGroupControllerRequest,
    @Res({ passthrough: true }) response: TaskGroupControllerResponse,
    @ContractQuery("listTaskGroups") query: TaskGroupListQueryRequest,
  ): Promise<TaskGroupListPage | ErrorResponseDto> {
    const requestId = randomUUID();
    const actor = await this.sessionAuth.resolveActor(
      getHeader(request.headers, "cookie"),
    );
    if (actor === undefined) {
      response.status(401);
      return {
        code: "TASK_GROUP_UNAUTHENTICATED",
        message: "需要有效认证 Session 才能查看任务聚合组",
        details: {},
        requestId,
      };
    }

    try {
      return await this.taskGroups.listTaskGroups({
        actorUserId: actor.userId,
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.projectId === undefined
          ? {}
          : { projectId: query.projectId }),
      });
    } catch (error) {
      return this.toErrorResponse(error, response, requestId, "查看任务聚合组");
    }
  }

  private toErrorResponse(
    error: unknown,
    response: TaskGroupControllerResponse,
    requestId: string,
    action: string,
  ): ErrorResponseDto {
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
      message: "服务器无法完成" + action,
      details: {},
      requestId,
    };
  }
}
