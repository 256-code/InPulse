import { Controller, Get, Inject, Patch, Post, Req, Res } from "@nestjs/common";
import { Operation } from "../../http/contract.decorators.js";
import {
  ModulesHttpService,
  type ModulesHttpRequest,
} from "./modules-http.service.js";

interface Response {
  status(code: number): unknown;
  setHeader(name: string, value: string): unknown;
}
@Controller("projects")
export class ModulesController {
  constructor(
    @Inject(ModulesHttpService) private readonly service: ModulesHttpService,
  ) {}

  @Get(":projectId/modules")
  @Operation("listModules")
  async list(
    @Req() request: ModulesHttpRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.respond("listModules", request, response);
  }
  @Post(":projectId/modules")
  @Operation("createModule")
  async create(
    @Req() request: ModulesHttpRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.respond("createModule", request, response);
  }
  @Patch(":projectId/modules/:moduleId")
  @Operation("updateModule")
  async update(
    @Req() request: ModulesHttpRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.respond("updateModule", request, response);
  }
  @Post(":projectId/modules/:moduleId/archive")
  @Operation("archiveModule")
  async archive(
    @Req() request: ModulesHttpRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.respond("archiveModule", request, response);
  }
  @Post(":projectId/modules/:moduleId/restore")
  @Operation("restoreModule")
  async restore(
    @Req() request: ModulesHttpRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.respond("restoreModule", request, response);
  }
  private async respond(
    operation: Parameters<ModulesHttpService["handle"]>[0],
    request: ModulesHttpRequest,
    response: Response,
  ) {
    const result = await this.service.handle(operation, request);
    response.status(result.status);
    response.setHeader("Cache-Control", "no-store");
    return result.body;
  }
}
