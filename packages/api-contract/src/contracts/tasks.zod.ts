import { z } from "zod";

const id = z.number().int().positive().max(2147483647);
const pathId = z.coerce.number().int().positive().max(2147483647);
export const taskCollectionPathSchema = z
  .object({ projectId: pathId, moduleId: pathId, featureId: pathId })
  .strict()
  .meta({ id: "TaskCollectionPath" });
export const taskResourcePathSchema = taskCollectionPathSchema
  .extend({ taskId: pathId })
  .meta({ id: "TaskResourcePath" });
export const taskEditRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    description: z.string().max(50000),
    priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]),
    assigneeId: id,
    dueAt: z.iso.datetime().nullable(),
  })
  .strict()
  .meta({ id: "TaskEditRequest" });
export const taskMutationHeadersSchema = z
  .object({ "x-csrf-token": z.string().length(43) })
  .strict()
  .meta({ id: "TaskMutationHeaders" });
export const taskVersionHeadersSchema = taskMutationHeadersSchema
  .extend({ "if-match": z.string().regex(/^"[1-9][0-9]{0,9}"$/) })
  .meta({ id: "TaskVersionHeaders" });
export const taskItemSchema = taskEditRequestSchema
  .extend({
    id,
    projectId: id,
    moduleId: id,
    featureId: id,
    scopeType: z.literal("FEATURE"),
    code: z.string().max(64),
    creatorId: id,
    workStatus: z.enum(["TODO", "DONE", "CANCELED"]),
    lifecycleStatus: z.enum(["ACTIVE", "ARCHIVED", "INVALID"]),
    rowVersion: id,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "TaskItem" });
export const taskListResponseSchema = z
  .object({ items: z.array(taskItemSchema) })
  .strict()
  .meta({ id: "TaskListResponse" });
export const taskReplayContextSchema = z
  .object({ projectId: id, moduleId: id, featureId: id, taskId: id })
  .strict()
  .meta({ id: "TaskReplayContext" });
export type TaskItem = z.infer<typeof taskItemSchema>;
export type TaskEditRequest = z.infer<typeof taskEditRequestSchema>;
export const taskAssigneesResponseSchema = z
  .object({
    items: z.array(
      z
        .object({
          id,
          name: z.string().max(200),
          avatarUrl: z.string().nullable(),
        })
        .strict(),
    ),
  })
  .strict()
  .meta({ id: "TaskAssigneesResponse" });
export const taskSchemas = {
  TaskAssigneesResponse: {
    schema: taskAssigneesResponseSchema,
    summary: "当前项目可指派成员",
    sensitiveFieldPaths: [],
  },
  TaskCollectionPath: {
    schema: taskCollectionPathSchema,
    summary: "任务真实父级归属",
    sensitiveFieldPaths: [],
  },
  TaskResourcePath: {
    schema: taskResourcePathSchema,
    summary: "任务资源归属",
    sensitiveFieldPaths: [],
  },
  TaskEditRequest: {
    schema: taskEditRequestSchema,
    summary: "任务可编辑字段",
    sensitiveFieldPaths: [],
  },
  TaskMutationHeaders: {
    schema: taskMutationHeadersSchema,
    summary: "任务创建安全头",
    sensitiveFieldPaths: ["x-csrf-token"],
  },
  TaskVersionHeaders: {
    schema: taskVersionHeadersSchema,
    summary: "任务版本安全头",
    sensitiveFieldPaths: ["x-csrf-token"],
  },
  TaskItem: {
    schema: taskItemSchema,
    summary: "功能级任务",
    sensitiveFieldPaths: [],
  },
  TaskListResponse: {
    schema: taskListResponseSchema,
    summary: "功能级任务列表",
    sensitiveFieldPaths: [],
  },
  TaskReplayContext: {
    schema: taskReplayContextSchema,
    summary: "任务重放授权资源",
    sensitiveFieldPaths: [],
  },
};
