import { Controller, HttpCode, Inject, Post, Req } from "@nestjs/common";
import type { DocumentImportAssistRequest } from "@inpulse/api-contract";

import type { HttpHeaderBag } from "../auth/csrf.http.js";
import { ContractBody, Operation } from "../http/contract.decorators.js";
import { DocumentImportHttpService } from "./document-import-http.service.js";

/** ADR-067 AI 辅助转换：仅已登录用户；纯校验接口，不写任何持久化状态。 */
@Controller("document-imports")
export class DocumentImportAssistController {
  constructor(
    @Inject(DocumentImportHttpService)
    private readonly service: DocumentImportHttpService,
  ) {}

  @Post("assist")
  @HttpCode(200)
  @Operation("assistDocumentImport")
  assist(
    @Req() request: { headers: HttpHeaderBag },
    @ContractBody("assistDocumentImport") body: DocumentImportAssistRequest,
  ) {
    return this.service.assist(request.headers, body);
  }
}
