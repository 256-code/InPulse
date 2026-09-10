import {
  Controller,
  Inject,
  Get,
  Post,
  Delete,
  Req,
  Res,
} from "@nestjs/common";
import {
  Operation,
  ContractPath,
  ContractQuery,
  ContractBody,
  ContractHeaders,
} from "../http/contract.decorators.js";
import { ExternalLinkHttpService } from "./external-link-http.service.js";
import type { CompletionHttpRequest } from "./task-completion-http.service.js";
interface Response {
  status(code: number): unknown;
  setHeader(name: string, value: string): unknown;
}
@Controller()
export class ExternalLinkController {
  constructor(
    @Inject(ExternalLinkHttpService)
    private readonly service: ExternalLinkHttpService,
  ) {}

  @Get("external-links/:targetType/:targetId")
  @Operation("listExternalLinks")
  async listExternalLinks(
    @Req() request: CompletionHttpRequest,
    @Res({ passthrough: true }) response: Response,
    @ContractPath("listExternalLinks") params: unknown,
    @ContractQuery("listExternalLinks") query: unknown,
  ) {
    const result = await this.service.handle("listExternalLinks", {
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

  @Post("external-links/:targetType/:targetId")
  @Operation("addExternalLink")
  async addExternalLink(
    @Req() request: CompletionHttpRequest,
    @Res({ passthrough: true }) response: Response,
    @ContractPath("addExternalLink") params: unknown,
    @ContractQuery("addExternalLink") query: unknown,
    @ContractHeaders("addExternalLink") _headers: unknown,
    @ContractBody("addExternalLink") body: unknown,
  ) {
    const result = await this.service.handle("addExternalLink", {
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

  @Delete("external-links/:targetType/:targetId/:linkId")
  @Operation("removeExternalLink")
  async removeExternalLink(
    @Req() request: CompletionHttpRequest,
    @Res({ passthrough: true }) response: Response,
    @ContractPath("removeExternalLink") params: unknown,
    @ContractQuery("removeExternalLink") query: unknown,
    @ContractHeaders("removeExternalLink") _headers: unknown,
    @ContractBody("removeExternalLink") body: unknown,
  ) {
    const result = await this.service.handle("removeExternalLink", {
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
}
