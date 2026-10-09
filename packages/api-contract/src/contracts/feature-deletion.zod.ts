import { z } from "zod";

const id = z.number().int().positive().max(2147483647);
const reason = z.string().trim().min(1).max(10000).nullable();

/**
 * ADR-059：功能删除。删除是软删除（`deleted_at` / `deleted_by`），功能从列表、详情、
 * 统计、搜索与全部功能级读写中消失，但功能行、任务、迭代记录与审计链全部保留。
 * 同一事务内级联：按其**自身**任务（`scope_type = 'FEATURE' AND feature_id = ?`）逐条执行
 * ADR-058 的单任务删除语义、作废本功能的已发布迭代记录，并移除搜索投影。
 *
 * 仅「受影响」本功能的模块级任务（`scope_type = 'MODULE'` 且出现在
 * `task_feature_impacts`）**不**随之删除，影响关系行本身也保留为业务历史。
 */
export const deleteFeatureRequestSchema = z
  .object({ reason })
  .strict()
  .meta({ id: "DeleteFeatureRequest" });

/** 删除结果只回述调用方需要确认的影响面；功能正文与审计细节留在各自读路由里。 */
export const featureDeletionResponseSchema = z
  .object({
    id,
    projectId: id,
    moduleId: id,
    code: z.string().min(1).max(64),
    name: z.string().min(1).max(500),
    deletedAt: z.iso.datetime(),
    deletedBy: id,
    /** 同事务级联删除的功能自身任务数。 */
    deletedTaskCount: z.number().int().min(0),
    /** 同事务作废的已发布迭代记录数（功能级与任务级之和）。 */
    voidedRecordCount: z.number().int().min(0),
    /** 同事务解除的外部链接关联数（含级联任务自身解除的关联）。 */
    removedLinkCount: z.number().int().min(0),
  })
  .strict()
  .meta({ id: "FeatureDeletionResponse" });

/**
 * 删除后功能不再可读，因此重放授权只回述「哪个功能在哪个归属下被删除」，
 * 实时门禁在重放时重新判定当前认证、当前成员关系与项目可写性。
 */
export const featureDeletionReplayContextSchema = z
  .object({ projectId: id, moduleId: id, featureId: id })
  .strict()
  .meta({ id: "FeatureDeletionReplayContext" });

export type DeleteFeatureRequest = z.infer<typeof deleteFeatureRequestSchema>;
export type FeatureDeletionResponse = z.infer<
  typeof featureDeletionResponseSchema
>;
export type FeatureDeletionReplayContext = z.infer<
  typeof featureDeletionReplayContextSchema
>;

export const featureDeletionSchemas = {
  DeleteFeatureRequest: {
    schema: deleteFeatureRequestSchema,
    summary: "删除功能的去重原因与非空命令体",
    sensitiveFieldPaths: [],
  },
  FeatureDeletionResponse: {
    schema: featureDeletionResponseSchema,
    summary: "删除功能结果与同事务级联的影响面计数",
    sensitiveFieldPaths: [],
  },
  FeatureDeletionReplayContext: {
    schema: featureDeletionReplayContextSchema,
    summary: "删除功能的实时归属授权资源",
    sensitiveFieldPaths: [],
  },
};
