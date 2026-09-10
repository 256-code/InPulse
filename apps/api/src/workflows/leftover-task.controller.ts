import { Controller, Inject, Get, Post, Req, Res } from "@nestjs/common";
import {
  Operation,
  ContractPath,
  ContractQuery,
  ContractBody,
  ContractHeaders,
} from "../http/contract.decorators.js";
import { LeftoverTaskHttpService } from "./leftover-task-http.service.js";
import type { CompletionHttpRequest } from "./task-completion-http.service.js";
interface Response {
  status(code: number): unknown;
  setHeader(name: string, value: string): unknown;
}
@Controller()
export class LeftoverTaskController {
  constructor(
    @Inject(LeftoverTaskHttpService)
    private readonly service: LeftoverTaskHttpService,
  ) {}
  @Post("projects/:projectId/change-records/:recordId/leftover-task")
  @Operation("convertLeftoverToTask")
  async convertLeftoverToTask(
    @Req() request: CompletionHttpRequest,
    @Res({ passthrough: true }) response: Response,
    @ContractPath("convertLeftoverToTask") params: unknown,
    @ContractQuery("convertLeftoverToTask") query: unknown,
    @ContractBody("convertLeftoverToTask") body: unknown,
    @ContractHeaders("convertLeftoverToTask") _headers: unknown,
  ) {
    const result = await this.service.handle("convertLeftoverToTask", {
      ...request,
      headers: request.headers,
      params,
      query,
      body: body,
    });
    response.status(result.status);
    response.setHeader("Cache-Control", "no-store");
    if (result.status >= 400)
      response.setHeader(
        "X-Request-Id",
        (result.body as { requestId: string }).requestId,
      );
    return result.body;
  }
  @Get("projects/:projectId/change-records/:recordId/leftover-task-preview")
  @Operation("previewLeftoverTask")
  async previewLeftoverTask(
    @Req() request: CompletionHttpRequest,
    @Res({ passthrough: true }) response: Response,
    @ContractPath("previewLeftoverTask") params: unknown,
    @ContractQuery("previewLeftoverTask") query: unknown,
  ) {
    const result = await this.service.handle("previewLeftoverTask", {
      ...request,
      headers: request.headers,
      params,
      query,
      body: undefined,
    });
    response.status(result.status);
    response.setHeader("Cache-Control", "no-store");
    if (result.status >= 400)
      response.setHeader(
        "X-Request-Id",
        (result.body as { requestId: string }).requestId,
      );
    return result.body;
  }
  @Get("tasks/:taskId/leftover-source")
  @Operation("getLeftoverTaskSource")
  async getLeftoverTaskSource(
    @Req() request: CompletionHttpRequest,
    @Res({ passthrough: true }) response: Response,
    @ContractPath("getLeftoverTaskSource") params: unknown,
    @ContractQuery("getLeftoverTaskSource") query: unknown,
  ) {
    const result = await this.service.handle("getLeftoverTaskSource", {
      ...request,
      headers: request.headers,
      params,
      query,
      body: undefined,
    });
    response.status(result.status);
    response.setHeader("Cache-Control", "no-store");
    if (result.status >= 400)
      response.setHeader(
        "X-Request-Id",
        (result.body as { requestId: string }).requestId,
      );
    return result.body;
  }
}
