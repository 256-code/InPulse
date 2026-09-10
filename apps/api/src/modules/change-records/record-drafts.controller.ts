import { Controller, Get, Post, Patch, Inject, Req, Res } from "@nestjs/common";
import {
  Operation,
  ContractPath,
  ContractQuery,
  ContractBody,
  ContractHeaders,
} from "../../http/contract.decorators.js";
import {
  RecordDraftsHttpService,
  type DraftHttpRequest,
} from "./record-drafts-http.service.js";
interface Response {
  status(code: number): unknown;
  setHeader(name: string, value: string): unknown;
}
@Controller("projects")
export class RecordDraftsController {
  constructor(
    @Inject(RecordDraftsHttpService)
    private readonly service: RecordDraftsHttpService,
  ) {}

  @Get(":projectId/record-drafts")
  @Operation("listRecordDrafts")
  async listRecordDrafts(
    @Req() request: DraftHttpRequest,
    @Res({ passthrough: true }) response: Response,
    @ContractPath("listRecordDrafts") params: unknown,
    @ContractQuery("listRecordDrafts") query: unknown,
  ) {
    const result = await this.service.handle("listRecordDrafts", {
      ...request,
      headers: request.headers,
      params,
      query,
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

  @Get(":projectId/record-drafts/:recordId")
  @Operation("getRecordDraft")
  async getRecordDraft(
    @Req() request: DraftHttpRequest,
    @Res({ passthrough: true }) response: Response,
    @ContractPath("getRecordDraft") params: unknown,
    @ContractQuery("getRecordDraft") query: unknown,
  ) {
    const result = await this.service.handle("getRecordDraft", {
      ...request,
      headers: request.headers,
      params,
      query,
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

  @Post(":projectId/modules/:moduleId/record-drafts")
  @Operation("createIndependentRecordDraft")
  async createIndependentRecordDraft(
    @Req() request: DraftHttpRequest,
    @Res({ passthrough: true }) response: Response,
    @ContractPath("createIndependentRecordDraft") params: unknown,
    @ContractQuery("createIndependentRecordDraft") query: unknown,
    @ContractBody("createIndependentRecordDraft") body: unknown,
    @ContractHeaders("createIndependentRecordDraft") _headers: unknown,
  ) {
    const result = await this.service.handle("createIndependentRecordDraft", {
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

  @Patch(":projectId/record-drafts/:recordId")
  @Operation("updateIndependentRecordDraft")
  async updateIndependentRecordDraft(
    @Req() request: DraftHttpRequest,
    @Res({ passthrough: true }) response: Response,
    @ContractPath("updateIndependentRecordDraft") params: unknown,
    @ContractQuery("updateIndependentRecordDraft") query: unknown,
    @ContractBody("updateIndependentRecordDraft") body: unknown,
    @ContractHeaders("updateIndependentRecordDraft") _headers: unknown,
  ) {
    const result = await this.service.handle("updateIndependentRecordDraft", {
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
