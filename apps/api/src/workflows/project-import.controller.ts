import { Controller, HttpCode, Inject, Post, Req } from "@nestjs/common";
import type {
  ProjectDocumentImportPreviewRequest,
  ProjectDocumentImportRequest,
} from "@inpulse/api-contract";

import type { HttpHeaderBag } from "../auth/csrf.http.js";
import {
  ContractBody,
  ContractHeaders,
  Operation,
} from "../http/contract.decorators.js";
import { DocumentImportHttpService } from "./document-import-http.service.js";

/** ADR-064 整项目文档导入：单事务创建项目与其全部下级。 */
@Controller("project-imports")
export class ProjectImportController {
  constructor(
    @Inject(DocumentImportHttpService)
    private readonly service: DocumentImportHttpService,
  ) {}

  @Post("preview")
  @HttpCode(200)
  @Operation("previewProjectImport")
  preview(
    @Req() request: { headers: HttpHeaderBag },
    @ContractBody("previewProjectImport")
    body: ProjectDocumentImportPreviewRequest,
  ) {
    return this.service.previewNewProject(request.headers, body);
  }

  @Post()
  @HttpCode(200)
  @Operation("importProject")
  apply(
    @Req() request: { headers: HttpHeaderBag },
    @ContractHeaders("importProject") _headers: unknown,
    @ContractBody("importProject") body: ProjectDocumentImportRequest,
  ) {
    return this.service.executeNewProject(request.headers, body);
  }
}
