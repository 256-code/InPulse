import { Controller, Post, Inject, Req, Res } from "@nestjs/common";
import {
  Operation,
  ContractPath,
  ContractQuery,
  ContractBody,
  ContractHeaders,
} from "../../http/contract.decorators.js";
import type { DraftHttpRequest } from "./record-drafts-http.service.js";
import { RecordLifecycleHttpService } from "./record-lifecycle-http.service.js";
interface Response {
  status(code: number): unknown;
  setHeader(name: string, value: string): unknown;
}
@Controller("projects")
export class RecordLifecycleController {
  constructor(
    @Inject(RecordLifecycleHttpService)
    private readonly service: RecordLifecycleHttpService,
  ) {}
  @Post(":projectId/change-records/:recordId/void")
  @Operation("voidChangeRecord")
  async voidChangeRecord(
    @Req() request: DraftHttpRequest,
    @Res({ passthrough: true }) response: Response,
    @ContractPath("voidChangeRecord") params: unknown,
    @ContractQuery("voidChangeRecord") query: unknown,
    @ContractBody("voidChangeRecord") body: unknown,
    @ContractHeaders("voidChangeRecord") _headers: unknown,
  ) {
    const result = await this.service.handle("voidChangeRecord", {
      ...request,
      headers: request.headers,
      params,
      query,
      body,
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

  @Post(":projectId/change-records/:recordId/restore")
  @Operation("restoreChangeRecord")
  async restoreChangeRecord(
    @Req() request: DraftHttpRequest,
    @Res({ passthrough: true }) response: Response,
    @ContractPath("restoreChangeRecord") params: unknown,
    @ContractQuery("restoreChangeRecord") query: unknown,
    @ContractBody("restoreChangeRecord") body: unknown,
    @ContractHeaders("restoreChangeRecord") _headers: unknown,
  ) {
    const result = await this.service.handle("restoreChangeRecord", {
      ...request,
      headers: request.headers,
      params,
      query,
      body,
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
