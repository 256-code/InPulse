import {
  Controller,
  Delete,
  Get,
  Inject,
  Patch,
  Post,
  Req,
  Res,
} from "@nestjs/common";

import { Operation } from "../http/contract.decorators.js";
import {
  OrganizationsHttpService,
  type OrganizationsHttpRequest,
} from "./organization-http.service.js";

interface OrganizationsControllerResponse {
  readonly status: (code: number) => unknown;
  readonly setHeader: (name: string, value: string) => unknown;
}

/** ADR-081 组织管理 HTTP 入口；只绑定 Route Registry，不直接访问数据库。 */
@Controller("admin")
export class OrganizationsController {
  constructor(
    @Inject(OrganizationsHttpService)
    private readonly service: OrganizationsHttpService,
  ) {}

  @Get("organizations")
  @Operation("listOrganizations")
  async list(
    @Req() request: OrganizationsHttpRequest,
    @Res({ passthrough: true }) response: OrganizationsControllerResponse,
  ) {
    return this.respond("listOrganizations", request, response);
  }

  @Post("organizations")
  @Operation("createOrganization")
  async create(
    @Req() request: OrganizationsHttpRequest,
    @Res({ passthrough: true }) response: OrganizationsControllerResponse,
  ) {
    return this.respond("createOrganization", request, response);
  }

  @Patch("organizations/:organizationId")
  @Operation("updateOrganization")
  async update(
    @Req() request: OrganizationsHttpRequest,
    @Res({ passthrough: true }) response: OrganizationsControllerResponse,
  ) {
    return this.respond("updateOrganization", request, response);
  }

  @Delete("organizations/:organizationId")
  @Operation("deleteOrganization")
  async remove(
    @Req() request: OrganizationsHttpRequest,
    @Res({ passthrough: true }) response: OrganizationsControllerResponse,
  ) {
    return this.respond("deleteOrganization", request, response);
  }

  @Post("users/organization")
  @Operation("assignUsersOrganization")
  async assignUsers(
    @Req() request: OrganizationsHttpRequest,
    @Res({ passthrough: true }) response: OrganizationsControllerResponse,
  ) {
    return this.respond("assignUsersOrganization", request, response);
  }

  private async respond(
    operation: Parameters<OrganizationsHttpService["handle"]>[0],
    request: OrganizationsHttpRequest,
    response: OrganizationsControllerResponse,
  ) {
    const result = await this.service.handle(operation, request);
    response.status(result.status);
    response.setHeader("Cache-Control", "no-store");
    return result.body;
  }
}
