import { Controller, HttpCode, Inject, Post, Req } from "@nestjs/common";
import type { RecordSummaryAssistRequest } from "@inpulse/api-contract";

import type { HttpHeaderBag } from "../auth/csrf.http.js";
import { ContractBody, Operation } from "../http/contract.decorators.js";
import { RecordSummaryAssistHttpService } from "./record-summary-assist-http.service.js";

/** ADR-076 迭代总结 AI 改写：仅已登录用户；纯校验接口，不写任何持久化状态。 */
@Controller("record-summaries")
export class RecordSummaryAssistController {
  constructor(
    @Inject(RecordSummaryAssistHttpService)
    private readonly service: RecordSummaryAssistHttpService,
  ) {}

  @Post("assist")
  @HttpCode(200)
  @Operation("assistRecordSummary")
  assist(
    @Req() request: { headers: HttpHeaderBag },
    @ContractBody("assistRecordSummary")
    body: RecordSummaryAssistRequest,
  ) {
    return this.service.assist(request.headers, body);
  }
}
