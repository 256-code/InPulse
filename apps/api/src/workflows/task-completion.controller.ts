import { Controller, Inject, Post, Req, Res } from "@nestjs/common";
import {
  Operation,
  ContractPath,
  ContractQuery,
  ContractBody,
  ContractHeaders,
} from "../http/contract.decorators.js";
import {
  TaskCompletionHttpService,
  type CompletionHttpRequest,
} from "./task-completion-http.service.js";
interface Response {
  status(code: number): unknown;
  setHeader(name: string, value: string): unknown;
}
@Controller("tasks")
export class TaskCompletionController {
  constructor(
    @Inject(TaskCompletionHttpService)
    private readonly service: TaskCompletionHttpService,
  ) {}
  @Post(":taskId/complete")
  @Operation("completeTask")
  async completeTask(
    @Req() request: CompletionHttpRequest,
    @Res({ passthrough: true }) response: Response,
    @ContractPath("completeTask") params: unknown,
    @ContractQuery("completeTask") query: unknown,
    @ContractBody("completeTask") body: unknown,
    @ContractHeaders("completeTask") _headers: unknown,
  ) {
    const result = await this.service.handle({
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
