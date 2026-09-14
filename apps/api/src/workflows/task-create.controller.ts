import { Controller, Post, Req, HttpCode, Inject } from "@nestjs/common";
import type { TaskCreateRequest } from "@inpulse/api-contract";
import type { HttpHeaderBag } from "../auth/csrf.http.js";
import {
  ContractBody,
  ContractPath,
  ContractHeaders,
  Operation,
} from "../http/contract.decorators.js";
import { TaskCreateHttpService } from "./task-create-http.service.js";
@Controller("projects")
export class TaskCreateController {
  constructor(
    @Inject(TaskCreateHttpService)
    private readonly service: TaskCreateHttpService,
  ) {}
  @Post(":projectId/tasks")
  @HttpCode(200)
  @Operation("createTaskWithScope")
  create(
    @Req() request: { headers: HttpHeaderBag },
    @ContractPath("createTaskWithScope") path: { projectId: number },
    @ContractBody("createTaskWithScope") body: TaskCreateRequest,
    @ContractHeaders("createTaskWithScope") _headers: unknown,
  ) {
    return this.service.create(request.headers, path.projectId, body);
  }
}
