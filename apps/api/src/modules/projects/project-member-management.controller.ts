import {
  Controller,
  Get,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";

import {
  ContractHeaders,
  ContractPath,
  Operation,
} from "../../http/contract.decorators.js";
import { StrictSameOriginGuard } from "../../auth/csrf.guard.js";
import {
  ProjectMemberManagementHttpService,
  type ProjectMemberHttpRequest,
} from "./project-member-management-http.service.js";

interface ProjectMemberControllerResponse {
  status(code: number): unknown;
  setHeader(name: string, value: string | readonly string[]): unknown;
}

/** F-05 项目成员管理 HTTP 入口；只绑定 Route Registry，不直接访问数据库。 */
@Controller("projects")
export class ProjectMemberManagementController {
  constructor(
    @Inject(ProjectMemberManagementHttpService)
    private readonly service: ProjectMemberManagementHttpService,
  ) {}

  @Get(":projectId/members")
  @Operation("listProjectMembers")
  async listMembers(
    @Req() request: ProjectMemberHttpRequest,
    @Res({ passthrough: true }) response: ProjectMemberControllerResponse,
    @ContractPath("listProjectMembers") params: unknown,
  ) {
    return this.respond("listProjectMembers", request, response, params);
  }

  @Get(":projectId/members/:userId/unfinished-tasks")
  @Operation("listProjectMemberUnfinishedTasks")
  async listUnfinishedTasks(
    @Req() request: ProjectMemberHttpRequest,
    @Res({ passthrough: true }) response: ProjectMemberControllerResponse,
    @ContractPath("listProjectMemberUnfinishedTasks") params: unknown,
  ) {
    return this.respond(
      "listProjectMemberUnfinishedTasks",
      request,
      response,
      params,
    );
  }

  @Post(":projectId/members")
  @UseGuards(StrictSameOriginGuard)
  @Operation("addProjectMember")
  async addMember(
    @Req() request: ProjectMemberHttpRequest,
    @Res({ passthrough: true }) response: ProjectMemberControllerResponse,
    @ContractPath("addProjectMember") params: unknown,
    @ContractHeaders("addProjectMember") _headers: unknown,
  ) {
    return this.respond("addProjectMember", request, response, params);
  }

  @Post(":projectId/members/:userId/remove")
  @UseGuards(StrictSameOriginGuard)
  @Operation("removeProjectMember")
  async removeMember(
    @Req() request: ProjectMemberHttpRequest,
    @Res({ passthrough: true }) response: ProjectMemberControllerResponse,
    @ContractPath("removeProjectMember") params: unknown,
    @ContractHeaders("removeProjectMember") _headers: unknown,
  ) {
    return this.respond("removeProjectMember", request, response, params);
  }

  private async respond(
    operation: Parameters<ProjectMemberManagementHttpService["handle"]>[0],
    request: ProjectMemberHttpRequest,
    response: ProjectMemberControllerResponse,
    params: unknown,
  ) {
    const result = await this.service.handle(operation, {
      headers: request.headers,
      query: request.query,
      params,
      body: request.body,
    });
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
