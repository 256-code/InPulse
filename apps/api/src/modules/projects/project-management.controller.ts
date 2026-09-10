import {
  Controller,
  Get,
  Inject,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";

import { StrictSameOriginGuard } from "../../auth/csrf.guard.js";
import { Operation } from "../../http/contract.decorators.js";
import {
  ProjectManagementHttpService,
  type ProjectManagementHttpRequest,
} from "./project-management-http.service.js";

interface ProjectControllerResponse {
  status(code: number): unknown;
  setHeader(name: string, value: string | readonly string[]): unknown;
}

/**
 * F-06 项目编辑/归档/恢复 HTTP 入口；只绑定 operationId 与契约装饰器，
 * 业务规则在服务与 Workflow 内，编码创建后不可修改。
 */
@Controller("projects")
export class ProjectManagementController {
  constructor(
    @Inject(ProjectManagementHttpService)
    private readonly service: ProjectManagementHttpService,
  ) {}

  @Patch(":projectId")
  @UseGuards(StrictSameOriginGuard)
  @Operation("updateProject")
  async update(
    @Req() request: ProjectManagementHttpRequest,
    @Res({ passthrough: true }) response: ProjectControllerResponse,
  ) {
    return this.respond("updateProject", request, response);
  }

  @Get(":projectId/archive-preview")
  @Operation("getProjectArchivePreview")
  async archivePreview(
    @Req() request: ProjectManagementHttpRequest,
    @Res({ passthrough: true }) response: ProjectControllerResponse,
  ) {
    return this.respond("getProjectArchivePreview", request, response);
  }

  @Post(":projectId/archive")
  @UseGuards(StrictSameOriginGuard)
  @Operation("archiveProject")
  async archive(
    @Req() request: ProjectManagementHttpRequest,
    @Res({ passthrough: true }) response: ProjectControllerResponse,
  ) {
    return this.respond("archiveProject", request, response);
  }

  @Post(":projectId/restore")
  @UseGuards(StrictSameOriginGuard)
  @Operation("restoreProject")
  async restore(
    @Req() request: ProjectManagementHttpRequest,
    @Res({ passthrough: true }) response: ProjectControllerResponse,
  ) {
    return this.respond("restoreProject", request, response);
  }

  private async respond(
    operation: Parameters<ProjectManagementHttpService["handle"]>[0],
    request: ProjectManagementHttpRequest,
    response: ProjectControllerResponse,
  ) {
    const result = await this.service.handle(operation, request);
    response.status(result.status);
    response.setHeader("Cache-Control", "no-store");
    if (result.status >= 400) {
      const body = result.body as { readonly requestId?: string };
      if (body.requestId !== undefined) {
        response.setHeader("X-Request-Id", body.requestId);
      }
    }
    return result.body;
  }
}
