import { RecordPublicationHttpService } from "./record-publication-http.service.js";
import { Controller, Get, Post, Inject, Req, Res } from "@nestjs/common";
import {
  Operation,
  ContractPath,
  ContractQuery,
  ContractBody,
  ContractHeaders,
} from "../../http/contract.decorators.js";
import type { DraftHttpRequest } from "./record-drafts-http.service.js";
import { PublishedRecordsHttpService } from "./published-records-http.service.js";
interface Response {
  status(code: number): unknown;
  setHeader(name: string, value: string): unknown;
}
@Controller("projects")
export class PublishedRecordsController {
  constructor(
    @Inject(PublishedRecordsHttpService)
    private readonly service: PublishedRecordsHttpService,
    @Inject(RecordPublicationHttpService)
    private readonly publication: RecordPublicationHttpService,
  ) {}

  @Get(":projectId/change-records")
  @Operation("listChangeRecords")
  async listChangeRecords(
    @Req() request: DraftHttpRequest,
    @Res({ passthrough: true }) response: Response,
    @ContractPath("listChangeRecords") params: unknown,
    @ContractQuery("listChangeRecords") query: unknown,
  ) {
    const result = await this.service.handle("listChangeRecords", {
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

  @Get(":projectId/change-records/:recordId")
  @Operation("getChangeRecord")
  async getChangeRecord(
    @Req() request: DraftHttpRequest,
    @Res({ passthrough: true }) response: Response,
    @ContractPath("getChangeRecord") params: unknown,
    @ContractQuery("getChangeRecord") query: unknown,
  ) {
    const result = await this.service.handle("getChangeRecord", {
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

  @Get(":projectId/change-records/:recordId/versions")
  @Operation("listChangeRecordVersions")
  async listChangeRecordVersions(
    @Req() request: DraftHttpRequest,
    @Res({ passthrough: true }) response: Response,
    @ContractPath("listChangeRecordVersions") params: unknown,
    @ContractQuery("listChangeRecordVersions") query: unknown,
  ) {
    const result = await this.service.handle("listChangeRecordVersions", {
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

  @Get(":projectId/change-records/:recordId/versions/:versionNo")
  @Operation("getChangeRecordVersion")
  async getChangeRecordVersion(
    @Req() request: DraftHttpRequest,
    @Res({ passthrough: true }) response: Response,
    @ContractPath("getChangeRecordVersion") params: unknown,
    @ContractQuery("getChangeRecordVersion") query: unknown,
  ) {
    const result = await this.service.handle("getChangeRecordVersion", {
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

  @Post(":projectId/change-records/:recordId/publish")
  @Operation("publishChangeRecord")
  async publishChangeRecord(
    @Req() request: DraftHttpRequest,
    @Res({ passthrough: true }) response: Response,
    @ContractPath("publishChangeRecord") params: unknown,
    @ContractQuery("publishChangeRecord") query: unknown,
    @ContractBody("publishChangeRecord") body: unknown,
    @ContractHeaders("publishChangeRecord") _headers: unknown,
  ) {
    const result = await this.publication.handle("publishChangeRecord", {
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

  @Post(":projectId/change-records/:recordId/versions")
  @Operation("createChangeRecordVersion")
  async createChangeRecordVersion(
    @Req() request: DraftHttpRequest,
    @Res({ passthrough: true }) response: Response,
    @ContractPath("createChangeRecordVersion") params: unknown,
    @ContractQuery("createChangeRecordVersion") query: unknown,
    @ContractBody("createChangeRecordVersion") body: unknown,
    @ContractHeaders("createChangeRecordVersion") _headers: unknown,
  ) {
    const result = await this.publication.handle("createChangeRecordVersion", {
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
