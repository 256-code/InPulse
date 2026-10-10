import { Controller, HttpCode, Inject, Post, Req } from "@nestjs/common";
import type {
  ProjectDocumentImportPreviewRequest,
  ProjectDocumentImportRequest,
} from "@inpulse/api-contract";

import type { HttpHeaderBag } from "../auth/csrf.http.js";
import {
  ContractBody,
  ContractHeaders,
  ContractPath,
  Operation,
} from "../http/contract.decorators.js";
import { DocumentImportHttpService } from "./document-import-http.service.js";

/** ADR-064 项目内文档导入：预览为纯校验接口，执行为幂等写命令。 */
@Controller("projects")
export class DocumentImportController {
  constructor(
    @Inject(DocumentImportHttpService)
    private readonly service: DocumentImportHttpService,
  ) {}

  @Post(":projectId/document-imports/preview")
  @HttpCode(200)
  @Operation("previewProjectDocumentImport")
  preview(
    @Req() request: { headers: HttpHeaderBag },
    @ContractPath("previewProjectDocumentImport") path: { projectId: number },
    @ContractBody("previewProjectDocumentImport")
    body: ProjectDocumentImportPreviewRequest,
  ) {
    return this.service.previewInProject(request.headers, path.projectId, body);
  }

  @Post(":projectId/document-imports")
  @HttpCode(200)
  @Operation("importProjectDocument")
  apply(
    @Req() request: { headers: HttpHeaderBag },
    @ContractPath("importProjectDocument") path: { projectId: number },
    @ContractHeaders("importProjectDocument") _headers: unknown,
    @ContractBody("importProjectDocument") body: ProjectDocumentImportRequest,
  ) {
    return this.service.executeInProject(request.headers, path.projectId, body);
  }
}
