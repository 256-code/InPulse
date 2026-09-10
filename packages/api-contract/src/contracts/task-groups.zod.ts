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
/**
 * 解除合并请求（技术设计 6.5 / 功能设计 18.14）：只描述来源任务与解除原因。
 * 项目、聚合组、主任务与成员快照由服务端在锁定后的真实关系上推导，客户端不得指定。
 * 原因按「建议填写」设计为可空；未填写时服务端写入固定文案，保证数据库
 * detach_reason 的非空约束不被绕过。
 */
export const taskGroupUnmergeRequestSchema = z
  .object({
    sourceTaskId: id,
    // 10000 与 task_group_members_detach_state_check 的 btrim 上限一致。
    unmergeReason: z.string().trim().max(10000).nullable(),
  })
  .strict()
  .meta({ id: "TaskGroupUnmergeRequest" });
/**
 * 解除后的成员：数据库 detach_state_check 保证 DETACHED 成员同时具备 detached_at
 * 与非空 detach_reason，这里按同一形状返回，客户端无需再猜解除时间与原因。
 */
export const taskGroupDetachedMemberItemSchema = z
  .object({
    id,
    taskId: id,
    role: z.enum(["MAIN", "SOURCE"]),
    sourceKind: z.enum(["ACTIVE", "HISTORICAL"]).nullable(),
    originalWorkStatus: z.enum(["TODO", "DONE", "CANCELED"]).nullable(),
    originalAssigneeId: id.nullable(),
    joinedAt: z.iso.datetime(),
    detachedAt: z.iso.datetime(),
    detachReason: z.string().min(1).max(10000),
  })
  .strict()
  .meta({ id: "TaskGroupDetachedMemberItem" });
/**
 * 解除后的聚合组状态：解除最后一个活跃 SOURCE 时，同一事务关闭聚合组并写入 closed_at，
 * 因此这里允许 CLOSED。MAIN 成员在组生命周期内始终存在（关闭时为 DETACHED），
 * mainTaskId 保持非空，历史关系仍可追溯。
 */
export const taskGroupStateItemSchema = z
  .object({
    id,
    projectId: id,
    code: z.string().max(64),
    name: z.string().max(500),
    status: z.enum(["ACTIVE", "CLOSED"]),
    createdBy: id,
    rowVersion: id,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    closedAt: z.iso.datetime().nullable(),
    mainTaskId: id,
  })
  .strict()
  .meta({ id: "TaskGroupStateItem" });
export const taskGroupUnmergeResponseSchema = z
  .object({
    group: taskGroupStateItemSchema,
    // 解除一个来源为 1 条；关闭组时同事务解除 MAIN，最多 2 条，按成员 ID 升序。
    detachedMembers: z.array(taskGroupDetachedMemberItemSchema).min(1).max(2),
  })
  .strict()
  .meta({ id: "TaskGroupUnmergeResponse" });
export const taskGroupUnmergeReplayContextSchema = z
  .object({ projectId: id, groupId: id, taskIds })
  .strict()
  .meta({ id: "TaskGroupUnmergeReplayContext" });
export const taskGroupUnmergeHeadersSchema = z
  .object({ "x-csrf-token": z.string().length(43) })
  .strict()
  .meta({ id: "TaskGroupUnmergeHeaders" });
export type TaskGroupMergeRequest = z.infer<typeof taskGroupMergeRequestSchema>;
export type TaskGroupItem = z.infer<typeof taskGroupItemSchema>;
export type TaskGroupMemberItem = z.infer<typeof taskGroupMemberItemSchema>;
export type TaskGroupUnmergeRequest = z.infer<
  typeof taskGroupUnmergeRequestSchema
>;
export type TaskGroupUnmergeResponse = z.infer<
  typeof taskGroupUnmergeResponseSchema
>;
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
  TaskGroupUnmergeRequest: {
    schema: taskGroupUnmergeRequestSchema,
    summary: "解除合并请求：来源任务与解除原因（建议填写，可为空）",
    sensitiveFieldPaths: [],
  },
  TaskGroupUnmergeHeaders: {
    schema: taskGroupUnmergeHeadersSchema,
    summary: "解除合并安全头",
    sensitiveFieldPaths: ["x-csrf-token"],
  },
  TaskGroupDetachedMemberItem: {
    schema: taskGroupDetachedMemberItemSchema,
    summary: "已解除的聚合组成员及其解除时间与原因",
    sensitiveFieldPaths: [],
  },
  TaskGroupStateItem: {
    schema: taskGroupStateItemSchema,
    summary: "解除后的聚合组状态，允许 CLOSED",
    sensitiveFieldPaths: [],
  },
  TaskGroupUnmergeResponse: {
    schema: taskGroupUnmergeResponseSchema,
    summary: "解除合并结果：聚合组最新状态与被解除的成员，不含任务字段变更",
    sensitiveFieldPaths: [],
  },
  TaskGroupUnmergeReplayContext: {
    schema: taskGroupUnmergeReplayContextSchema,
    summary: "解除合并结果重放需要重新校验的项目、聚合组与任务",
    sensitiveFieldPaths: [],
  },
};
