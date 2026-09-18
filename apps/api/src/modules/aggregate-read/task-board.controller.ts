import { randomUUID } from "node:crypto";

import { Controller, Get, Req, Res } from "@nestjs/common";

import type { ProjectPath, TaskBoardResponse } from "@inpulse/api-contract";

import { SessionAuthService } from "../../auth/session-auth.service.js";
import { getHeader, type HttpHeaderBag } from "../../auth/csrf.http.js";
import { ContractPath, Operation } from "../../http/contract.decorators.js";
import { AggregateReadError } from "./aggregate-read.errors.js";
import { TaskBoardQueryService } from "./task-board-query.service.js";

interface TaskBoardControllerRequest {
  readonly headers: HttpHeaderBag;
}

interface TaskBoardControllerResponse {
  status(code: number): unknown;
}

interface ErrorResponseDto {
  readonly code: string;
  readonly message: string;
  readonly details: Readonly<Record<string, string>>;
  readonly requestId: string;
}

/**
 * R-8 项目任务看板。只绑定 getProjectTaskBoard，先解析 Session 再由服务层取得
 * 服务端 AuthorizedProjectScope；非成员与项目不存在统一 404，不泄露项目存在性。
 * 路由没有查询参数：统计、逾期与截止状态等全部口径由服务端计算，前端不重算。
 */
@Controller("projects")
export class TaskBoardController {
  constructor(
    private readonly sessionAuth: SessionAuthService,
    private readonly board: TaskBoardQueryService,
  ) {}

  @Get(":projectId/task-board")
  @Operation("getProjectTaskBoard")
  async getProjectTaskBoard(
    @Req() request: TaskBoardControllerRequest,
    @Res({ passthrough: true }) response: TaskBoardControllerResponse,
    @ContractPath("getProjectTaskBoard") params: ProjectPath,
  ): Promise<TaskBoardResponse | ErrorResponseDto> {
    const requestId = randomUUID();
    const actor = await this.sessionAuth.resolveActor(
      getHeader(request.headers, "cookie"),
    );
    if (actor === undefined) {
      response.status(401);
      return {
        code: "TASK_BOARD_UNAUTHENTICATED",
        message: "需要有效认证 Session 才能查看任务看板",
        details: {},
        requestId,
      };
    }

    try {
      return await this.board.getBoard({
        actorUserId: actor.userId,
        projectId: params.projectId,
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
        message: "服务器无法完成任务看板查询",
        details: {},
        requestId,
      };
    }
  }
}
