import { Controller, Get, Inject, Patch, Post, Req, Res } from "@nestjs/common";
import {
  Operation,
  ContractBody,
  ContractPath,
  ContractQuery,
  ContractHeaders,
} from "../../http/contract.decorators.js";
import {
  FeaturesHttpService,
  type FeaturesHttpRequest,
} from "./features-http.service.js";
interface Response {
  status(code: number): unknown;
  setHeader(name: string, value: string): unknown;
}
@Controller("projects")
export class FeaturesController {
  constructor(
    @Inject(FeaturesHttpService) private readonly service: FeaturesHttpService,
  ) {}
  @Get(":projectId/modules/:moduleId/features")
  @Operation("listFeatures")
  async listFeatures(
    @Req() request: FeaturesHttpRequest,
    @Res({ passthrough: true }) response: Response,
    @ContractPath("listFeatures") params: unknown,
    @ContractQuery("listFeatures") query: unknown,
  ) {
    const result = await this.service.handle("listFeatures", {
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
  @Get(":projectId/modules/:moduleId/features/similar")
  @Operation("findSimilarFeatures")
  async findSimilarFeatures(
    @Req() request: FeaturesHttpRequest,
    @Res({ passthrough: true }) response: Response,
    @ContractPath("findSimilarFeatures") params: unknown,
    @ContractQuery("findSimilarFeatures") query: unknown,
  ) {
    const result = await this.service.handle("findSimilarFeatures", {
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
  @Get(":projectId/modules/:moduleId/features/:featureId")
  @Operation("getFeature")
  async getFeature(
    @Req() request: FeaturesHttpRequest,
    @Res({ passthrough: true }) response: Response,
    @ContractPath("getFeature") params: unknown,
    @ContractQuery("getFeature") query: unknown,
  ) {
    const result = await this.service.handle("getFeature", {
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
  @Post(":projectId/modules/:moduleId/features")
  @Operation("createFeature")
  async createFeature(
    @Req() request: FeaturesHttpRequest,
    @Res({ passthrough: true }) response: Response,
    @ContractPath("createFeature") params: unknown,
    @ContractQuery("createFeature") query: unknown,
    @ContractBody("createFeature") body: unknown,
    @ContractHeaders("createFeature") _headers: unknown,
  ) {
    const result = await this.service.handle("createFeature", {
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
  @Patch(":projectId/modules/:moduleId/features/:featureId")
  @Operation("updateFeature")
  async updateFeature(
    @Req() request: FeaturesHttpRequest,
    @Res({ passthrough: true }) response: Response,
    @ContractPath("updateFeature") params: unknown,
    @ContractQuery("updateFeature") query: unknown,
    @ContractBody("updateFeature") body: unknown,
    @ContractHeaders("updateFeature") _headers: unknown,
  ) {
    const result = await this.service.handle("updateFeature", {
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
  @Post(":projectId/modules/:moduleId/features/:featureId/archive")
  @Operation("archiveFeature")
  async archiveFeature(
    @Req() request: FeaturesHttpRequest,
    @Res({ passthrough: true }) response: Response,
    @ContractPath("archiveFeature") params: unknown,
    @ContractQuery("archiveFeature") query: unknown,
    @ContractBody("archiveFeature") body: unknown,
    @ContractHeaders("archiveFeature") _headers: unknown,
  ) {
    const result = await this.service.handle("archiveFeature", {
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
  @Post(":projectId/modules/:moduleId/features/:featureId/restore")
  @Operation("restoreFeature")
  async restoreFeature(
    @Req() request: FeaturesHttpRequest,
    @Res({ passthrough: true }) response: Response,
    @ContractPath("restoreFeature") params: unknown,
    @ContractQuery("restoreFeature") query: unknown,
    @ContractBody("restoreFeature") body: unknown,
    @ContractHeaders("restoreFeature") _headers: unknown,
  ) {
    const result = await this.service.handle("restoreFeature", {
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
