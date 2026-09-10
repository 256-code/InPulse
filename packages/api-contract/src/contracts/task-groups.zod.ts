import { z } from "zod";

const id = z.number().int().positive().max(2147483647);
/** 重放授权必须至少复核一个结果任务，空集合会让门禁形同虚设。 */
const taskIds = z
  .array(id)
  .min(1)
  .max(1000)
  .overwrite((values) => [...new Set(values)].sort((a, b) => a - b));
/**
 * 技术设计 6.4 / 功能设计 18.8：合并请求只描述来源、主任务与分支类型。
 * 归属、快照和聚合组由服务端根据锁定后的真实任务推导，客户端不得指定。
 */
export const taskGroupMergeRequestSchema = z
  .object({
    sourceTaskId: id,
    mainTaskId: id,
    sourceKind: z.enum(["HISTORICAL", "ACTIVE"]),
    // 5000 与搜索投影 summary、通知 body 上限一致，避免服务端静默截断用户说明。
    mergeNote: z.string().trim().max(5000).nullable(),
  })
  .strict()
  .meta({ id: "TaskGroupMergeRequest" });
export const taskGroupMemberItemSchema = z
  .object({
    id,
    taskId: id,
    role: z.enum(["MAIN", "SOURCE"]),
    sourceKind: z.enum(["ACTIVE", "HISTORICAL"]).nullable(),
    status: z.enum(["ACTIVE", "DETACHED"]),
    originalWorkStatus: z.enum(["TODO", "DONE", "CANCELED"]).nullable(),
    originalAssigneeId: id.nullable(),
    joinedAt: z.iso.datetime(),
  })
  .strict()
  .meta({ id: "TaskGroupMemberItem" });
/**
 * 合并成功后聚合组必然处于 ACTIVE：本次事务刚写入一个活跃 SOURCE，
 * 数据库 shape 约束保证 ACTIVE 组恰好一个 MAIN 且至少一个 SOURCE。
 */
export const taskGroupItemSchema = z
  .object({
    id,
    projectId: id,
    code: z.string().max(64),
    name: z.string().max(500),
    status: z.literal("ACTIVE"),
    createdBy: id,
    rowVersion: id,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    mainTaskId: id,
    members: z.array(taskGroupMemberItemSchema).max(1000),
  })
  .strict()
  .meta({ id: "TaskGroupItem" });
export const taskGroupMergeReplayContextSchema = z
  .object({ projectId: id, groupId: id, taskIds })
  .strict()
  .meta({ id: "TaskGroupMergeReplayContext" });
export const taskGroupMergeHeadersSchema = z
  .object({ "x-csrf-token": z.string().length(43) })
  .strict()
  .meta({ id: "TaskGroupMergeHeaders" });
export type TaskGroupMergeRequest = z.infer<typeof taskGroupMergeRequestSchema>;
export type TaskGroupItem = z.infer<typeof taskGroupItemSchema>;
export type TaskGroupMemberItem = z.infer<typeof taskGroupMemberItemSchema>;
export const taskGroupSchemas = {
  TaskGroupMergeRequest: {
    schema: taskGroupMergeRequestSchema,
    summary: "合并请求：来源任务、主任务、分支类型与合并说明",
    sensitiveFieldPaths: [],
  },
  TaskGroupMergeHeaders: {
    schema: taskGroupMergeHeadersSchema,
    summary: "合并创建安全头",
    sensitiveFieldPaths: ["x-csrf-token"],
  },
  TaskGroupMemberItem: {
    schema: taskGroupMemberItemSchema,
    summary: "聚合组成员及其合并时快照",
    sensitiveFieldPaths: [],
  },
  TaskGroupItem: {
    schema: taskGroupItemSchema,
    summary: "合并后的任务聚合组与全部成员，不包含任务字段变更",
    sensitiveFieldPaths: [],
  },
  TaskGroupMergeReplayContext: {
    schema: taskGroupMergeReplayContextSchema,
    summary: "合并结果重放需要重新校验的项目、聚合组与任务",
    sensitiveFieldPaths: [],
  },
};
