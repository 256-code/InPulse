import { Controller, Inject, Post, Req, Res } from "@nestjs/common";

import { Operation } from "../../http/contract.decorators.js";
import {
  ProjectArchiveRequestHttpService,
  type ProjectArchiveHttpRequest,
  type ProjectArchiveRequestOperation,
} from "./project-archive-request-http.service.js";

interface ProjectArchiveResponse {
  status(code: number): unknown;
  setHeader(name: string, value: string | readonly string[]): unknown;
}

/**
 * F-06.2 项目归档申请 HTTP 入口：只绑定 operationId 与契约装饰器，
 * 业务规则与角色门禁在服务内，申请不改变项目状态。
 */
@Controller("projects")
export class ProjectArchiveRequestController {
  constructor(
    @Inject(ProjectArchiveRequestHttpService)
    private readonly service: ProjectArchiveRequestHttpService,
  ) {}

  @Post(":projectId/archive-requests")
  @Operation("requestProjectArchive")
  async requestArchive(
    @Req() request: ProjectArchiveHttpRequest,
    @Res({ passthrough: true }) response: ProjectArchiveResponse,
  ) {
    return this.respond("requestProjectArchive", request, response);
  }

  @Post(":projectId/archive-requests/:requestId/approve")
  @Operation("approveProjectArchive")
  async approveArchive(
    @Req() request: ProjectArchiveHttpRequest,
    @Res({ passthrough: true }) response: ProjectArchiveResponse,
  ) {
    return this.respond("approveProjectArchive", request, response);
  }

  @Post(":projectId/archive-requests/:requestId/reject")
  @Operation("rejectProjectArchive")
  async rejectArchive(
    @Req() request: ProjectArchiveHttpRequest,
    @Res({ passthrough: true }) response: ProjectArchiveResponse,
  ) {
    return this.respond("rejectProjectArchive", request, response);
  }

  private async respond(
    operation: ProjectArchiveRequestOperation,
    request: ProjectArchiveHttpRequest,
    response: ProjectArchiveResponse,
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
