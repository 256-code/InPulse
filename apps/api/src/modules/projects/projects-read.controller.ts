import { randomUUID } from "node:crypto";

import { Controller, Get, Inject, Req, Res } from "@nestjs/common";
import type {
  ProjectPath,
  ProjectDetailResponse,
  ProjectListResponse,
} from "@inpulse/api-contract";
import { ContractPath, Operation } from "../../http/contract.decorators.js";
import { getHeader, type HttpHeaderBag } from "../../auth/csrf.http.js";
import {
  ProjectsReadService,
  ProjectReadServiceError,
} from "./projects-read.service.js";

interface ProjectsReadControllerRequest {
  readonly headers: HttpHeaderBag;
}

interface ProjectsReadControllerResponse {
  status(code: number): unknown;
  setHeader(name: string, value: string | readonly string[]): unknown;
}

interface ErrorResponseDto {
  readonly code: string;
  readonly message: string;
  readonly details: Readonly<Record<string, string>>;
  readonly requestId: string;
}

/** F-05.1 项目读取入口；只从 Session 解析 actor，不接受客户端授权范围。 */
@Controller("projects")
export class ProjectsReadController {
  constructor(
    @Inject(ProjectsReadService) private readonly service: ProjectsReadService,
  ) {}

  @Get()
  @Operation("listProjects")
  async list(
    @Req() request: ProjectsReadControllerRequest,
    @Res({ passthrough: true }) response: ProjectsReadControllerResponse,
  ): Promise<ProjectListResponse | ErrorResponseDto> {
    const requestId = randomUUID();
    response.setHeader("Cache-Control", "no-store");
    try {
      return await this.service.list(getHeader(request.headers, "cookie"));
    } catch (error) {
      return this.mapError(error, requestId, response, "项目列表");
    }
  }

  @Get(":projectId")
  @Operation("getProject")
  async detail(
    @Req() request: ProjectsReadControllerRequest,
    @Res({ passthrough: true }) response: ProjectsReadControllerResponse,
    @ContractPath("getProject") params: ProjectPath,
  ): Promise<ProjectDetailResponse | ErrorResponseDto> {
    const requestId = randomUUID();
    response.setHeader("Cache-Control", "no-store");
    try {
      return await this.service.detail(
        getHeader(request.headers, "cookie"),
        params.projectId,
      );
    } catch (error) {
      return this.mapError(error, requestId, response, "项目详情");
    }
  }

  private mapError(
    error: unknown,
    requestId: string,
    response: ProjectsReadControllerResponse,
    resource: string,
  ): ErrorResponseDto {
    if (error instanceof ProjectReadServiceError) {
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
      message: `服务器无法读取${resource}`,
      details: {},
      requestId,
    };
  }
}
