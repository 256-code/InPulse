import { Controller, Get, Inject, Patch, Post, Req, Res } from "@nestjs/common";
import {
  Operation,
  ContractBody,
  ContractPath,
  ContractQuery,
  ContractHeaders,
} from "../../http/contract.decorators.js";
import {
  TasksHttpService,
  type TasksHttpRequest,
} from "./tasks-http.service.js";
interface Response {
  status(code: number): unknown;
  setHeader(name: string, value: string): unknown;
}
@Controller("projects")
export class TasksController {
  constructor(
    @Inject(TasksHttpService) private readonly service: TasksHttpService,
  ) {}
  @Get(":projectId/modules/:moduleId/features/:featureId/tasks")
  @Operation("listTasks")
  async listTasks(
    @Req() request: TasksHttpRequest,
    @Res({ passthrough: true }) response: Response,
    @ContractPath("listTasks") params: unknown,
    @ContractQuery("listTasks") query: unknown,
  ) {
    const result = await this.service.handle("listTasks", {
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
  @Get(":projectId/modules/:moduleId/features/:featureId/tasks/assignees")
  @Operation("listTaskAssignees")
  async listTaskAssignees(
    @Req() request: TasksHttpRequest,
    @Res({ passthrough: true }) response: Response,
    @ContractPath("listTaskAssignees") params: unknown,
    @ContractQuery("listTaskAssignees") query: unknown,
  ) {
    const result = await this.service.handle("listTaskAssignees", {
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
  @Get(":projectId/modules/:moduleId/features/:featureId/tasks/:taskId")
  @Operation("getTask")
  async getTask(
    @Req() request: TasksHttpRequest,
    @Res({ passthrough: true }) response: Response,
    @ContractPath("getTask") params: unknown,
    @ContractQuery("getTask") query: unknown,
  ) {
    const result = await this.service.handle("getTask", {
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
  @Post(":projectId/modules/:moduleId/features/:featureId/tasks")
  @Operation("createTask")
  async createTask(
    @Req() request: TasksHttpRequest,
    @Res({ passthrough: true }) response: Response,
    @ContractPath("createTask") params: unknown,
    @ContractQuery("createTask") query: unknown,
    @ContractBody("createTask") body: unknown,
    @ContractHeaders("createTask") _headers: unknown,
  ) {
    const result = await this.service.handle("createTask", {
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
  @Patch(":projectId/modules/:moduleId/features/:featureId/tasks/:taskId")
  @Operation("updateTask")
  async updateTask(
    @Req() request: TasksHttpRequest,
    @Res({ passthrough: true }) response: Response,
    @ContractPath("updateTask") params: unknown,
    @ContractQuery("updateTask") query: unknown,
    @ContractBody("updateTask") body: unknown,
    @ContractHeaders("updateTask") _headers: unknown,
  ) {
    const result = await this.service.handle("updateTask", {
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
  @Get(":projectId/modules/:moduleId/tasks")
  @Operation("listModuleTasks")
  async listModuleTasks(
    @Req() request: TasksHttpRequest,
    @Res({ passthrough: true }) response: Response,
    @ContractPath("listModuleTasks") params: unknown,
    @ContractQuery("listModuleTasks") query: unknown,
  ) {
    const result = await this.service.handle("listModuleTasks", {
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
  @Get(":projectId/modules/:moduleId/tasks/assignees")
  @Operation("listModuleTaskAssignees")
  async listModuleTaskAssignees(
    @Req() request: TasksHttpRequest,
    @Res({ passthrough: true }) response: Response,
    @ContractPath("listModuleTaskAssignees") params: unknown,
    @ContractQuery("listModuleTaskAssignees") query: unknown,
  ) {
    const result = await this.service.handle("listModuleTaskAssignees", {
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
  @Get(":projectId/modules/:moduleId/tasks/:taskId")
  @Operation("getModuleTask")
  async getModuleTask(
    @Req() request: TasksHttpRequest,
    @Res({ passthrough: true }) response: Response,
    @ContractPath("getModuleTask") params: unknown,
    @ContractQuery("getModuleTask") query: unknown,
  ) {
    const result = await this.service.handle("getModuleTask", {
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
  @Post(":projectId/modules/:moduleId/tasks")
  @Operation("createModuleTask")
  async createModuleTask(
    @Req() request: TasksHttpRequest,
    @Res({ passthrough: true }) response: Response,
    @ContractPath("createModuleTask") params: unknown,
    @ContractQuery("createModuleTask") query: unknown,
    @ContractBody("createModuleTask") body: unknown,
    @ContractHeaders("createModuleTask") _headers: unknown,
  ) {
    const result = await this.service.handle("createModuleTask", {
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
  @Patch(":projectId/modules/:moduleId/tasks/:taskId")
  @Operation("updateModuleTask")
  async updateModuleTask(
    @Req() request: TasksHttpRequest,
    @Res({ passthrough: true }) response: Response,
    @ContractPath("updateModuleTask") params: unknown,
    @ContractQuery("updateModuleTask") query: unknown,
    @ContractBody("updateModuleTask") body: unknown,
    @ContractHeaders("updateModuleTask") _headers: unknown,
  ) {
    const result = await this.service.handle("updateModuleTask", {
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
