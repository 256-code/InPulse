import { Controller, Get, Post, Patch, Inject, Req, Res } from "@nestjs/common";
import {
  Operation,
  ContractPath,
  ContractQuery,
  ContractBody,
  ContractHeaders,
} from "../http/contract.decorators.js";
import {
  TaskRecordDraftHttpService,
  type TaskDraftHttpRequest,
} from "./task-record-draft-http.service.js";
interface Response {
  status(code: number): unknown;
  setHeader(name: string, value: string): unknown;
}
@Controller("projects")
export class TaskRecordDraftController {
  constructor(
    @Inject(TaskRecordDraftHttpService)
    private readonly service: TaskRecordDraftHttpService,
  ) {}

  // prettier-ignore
  @Get(":projectId/modules/:moduleId/tasks/:taskId/record-drafts")
 @Operation("getTaskRecordDrafts")
 async getTaskRecordDrafts(@Req() request:TaskDraftHttpRequest,@Res({passthrough:true}) response:Response,@ContractPath("getTaskRecordDrafts") params:unknown,@ContractQuery("getTaskRecordDrafts") query:unknown,){
 const result=await this.service.handle("getTaskRecordDrafts",{...request,headers:request.headers,params,query,});response.status(result.status);response.setHeader("Cache-Control","no-store");if(result.status>=400)response.setHeader("X-Request-Id",(result.body as {requestId:string}).requestId);return result.body;}

  // prettier-ignore
  @Post(":projectId/modules/:moduleId/tasks/:taskId/record-drafts")
 @Operation("createTaskRecordDraft")
 async createTaskRecordDraft(@Req() request:TaskDraftHttpRequest,@Res({passthrough:true}) response:Response,@ContractPath("createTaskRecordDraft") params:unknown,@ContractQuery("createTaskRecordDraft") query:unknown,@ContractBody("createTaskRecordDraft") body:unknown,@ContractHeaders("createTaskRecordDraft") _headers:unknown,){
 const result=await this.service.handle("createTaskRecordDraft",{...request,headers:request.headers,params,query,body});response.status(result.status);response.setHeader("Cache-Control","no-store");if(result.status>=400)response.setHeader("X-Request-Id",(result.body as {requestId:string}).requestId);return result.body;}

  // prettier-ignore
  @Patch(":projectId/modules/:moduleId/tasks/:taskId/record-drafts/:recordId")
 @Operation("updateTaskRecordDraft")
 async updateTaskRecordDraft(@Req() request:TaskDraftHttpRequest,@Res({passthrough:true}) response:Response,@ContractPath("updateTaskRecordDraft") params:unknown,@ContractQuery("updateTaskRecordDraft") query:unknown,@ContractBody("updateTaskRecordDraft") body:unknown,@ContractHeaders("updateTaskRecordDraft") _headers:unknown,){
 const result=await this.service.handle("updateTaskRecordDraft",{...request,headers:request.headers,params,query,body});response.status(result.status);response.setHeader("Cache-Control","no-store");if(result.status>=400)response.setHeader("X-Request-Id",(result.body as {requestId:string}).requestId);return result.body;}
}
