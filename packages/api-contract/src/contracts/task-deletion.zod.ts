import { z } from "zod";

const id = z.number().int().positive().max(2147483647);
const reason = z.string().trim().min(1).max(10000).nullable();

/**
 * ADR-058：取消任务升级为「删除任务」。删除是软删除（`deleted_at` / `deleted_by`），
 * 任务从列表、详情、看板、统计、搜索与全部任务级读写中消失，但历史、状态记录与审计链
 * 全部保留；同一事务内解除该任务的外部链接关联、作废其已发布迭代记录并解除聚合组关系。
 * 删除不可恢复：没有还原路由，也不复用 `transitionTask` 的 CANCEL / RESTORE。
 */
export const deleteTaskRequestSchema = z
  .object({ reason })
  .strict()
  .meta({ id: "DeleteTaskRequest" });

/** 删除结果只回述调用方需要确认的影响面；任务正文与审计细节留在各自读路由里。 */
export const taskDeletionResponseSchema = z
  .object({
    id,
    projectId: id,
    moduleId: id,
    featureId: id.nullable(),
    code: z.string().min(1).max(64),
    title: z.string().min(1).max(500),
    /** 删除时刻的工作状态快照：删除不改变状态，只把它从可见范围移除。 */
    workStatus: z.enum(["TODO", "DONE", "CANCELED"]),
    deletedAt: z.iso.datetime(),
    deletedBy: id,
    /** 同事务作废的已发布迭代记录数。 */
    voidedRecordCount: z.number().int().min(0),
    /** 同事务解除的任务外部链接关联数。 */
    removedLinkCount: z.number().int().min(0),
    /** 删除时解除的聚合组身份；不在活跃聚合组中为 null。 */
    detachedGroupRole: z.enum(["MAIN", "SOURCE"]).nullable(),
  })
  .strict()
  .meta({ id: "TaskDeletionResponse" });

/**
 * 删除后任务不再可读，因此重放授权只回述「哪个任务在哪个归属下被删除」，
 * 实时门禁在重放时重新判定当前认证、当前成员关系与项目可写性。
 */
export const taskDeletionReplayContextSchema = z
  .object({
    projectId: id,
    moduleId: id,
    featureId: id.nullable(),
    taskId: id,
  })
  .strict()
  .meta({ id: "TaskDeletionReplayContext" });

export type DeleteTaskRequest = z.infer<typeof deleteTaskRequestSchema>;
export type TaskDeletionResponse = z.infer<typeof taskDeletionResponseSchema>;
export type TaskDeletionReplayContext = z.infer<
  typeof taskDeletionReplayContextSchema
>;

export const taskDeletionSchemas = {
  DeleteTaskRequest: {
    schema: deleteTaskRequestSchema,
    summary: "删除任务的去重原因与非空命令体",
    sensitiveFieldPaths: [],
  },
  TaskDeletionResponse: {
    schema: taskDeletionResponseSchema,
    summary: "删除结果与同事务解除、作废的影响面计数",
    sensitiveFieldPaths: [],
  },
  TaskDeletionReplayContext: {
    schema: taskDeletionReplayContextSchema,
    summary: "删除任务的实时归属授权资源",
    sensitiveFieldPaths: [],
  },
};
