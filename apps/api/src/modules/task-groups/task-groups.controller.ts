import { Controller, Inject, Post, Req, Res } from "@nestjs/common";
import {
  Operation,
  ContractBody,
  ContractHeaders,
} from "../../http/contract.decorators.js";
import {
  TaskGroupsHttpService,
  type TaskGroupHttpRequest,
} from "./task-groups-http.service.js";
interface Response {
  status(code: number): unknown;
  setHeader(name: string, value: string): unknown;
}
/** F-23 合并入口：无路径/查询参数，归属由请求体任务 ID 在服务端解析。 */
@Controller("task-groups")
export class TaskGroupsController {
  constructor(
    @Inject(TaskGroupsHttpService)
    private readonly service: TaskGroupsHttpService,
  ) {}

  @Post("merge")
  @Operation("mergeTaskGroup")
  async mergeTaskGroup(
    @Req() request: TaskGroupHttpRequest,
    @Res({ passthrough: true }) response: Response,
    @ContractBody("mergeTaskGroup") body: unknown,
    @ContractHeaders("mergeTaskGroup") _headers: unknown,
  ) {
    const result = await this.service.handle({
      headers: request.headers,
      params: {},
      query: request.query,
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
