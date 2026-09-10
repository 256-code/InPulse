import { z } from "zod";
import { taskEditRequestSchema } from "./tasks.zod.js";
const id = z.number().int().positive().max(2147483647);
const ids = z
  .array(id)
  .max(300)
  .refine(
    (values) => new Set(values).size === values.length,
    "影响功能不能重复",
  );
export const leftoverTaskRequestSchema = taskEditRequestSchema
  .omit({ description: true })
  .extend({
    leftoverItemId: id,
    recordVersion: id,
    expectedRowVersion: id,
    leftoverExpectedRowVersion: id,
    expectedImpactFeatureIds: ids,
  })
  .strict()
  .meta({ id: "LeftoverTaskRequest" });
export const leftoverTaskReferenceSchema = z
  .object({ projectId: id, moduleId: id, featureId: id.nullable(), taskId: id })
  .strict();
export const leftoverTaskResponseSchema = leftoverTaskReferenceSchema
  .extend({
    recordId: id,
    leftoverItemId: id,
    recordVersion: id,
    recordRowVersion: id,
    leftoverRowVersion: id,
    impactFeatureIds: z.array(id),
  })
  .meta({ id: "LeftoverTaskResponse" });
export const leftoverTaskPreviewSchema = z
  .object({
    recordId: id,
    recordVersion: id,
    rowVersion: id,
    leftoverItemId: id,
    leftoverRowVersion: id,
    status: z.enum(["ACTIVE", "CONVERTED", "RESOLVED"]),
    content: z.string().max(10000),
    inheritedImpacts: z.array(z.object({ id, name: z.string() }).strict()),
    excludedImpacts: z.array(z.object({ id, name: z.string() }).strict()),
    linkedTask: leftoverTaskReferenceSchema.nullable(),
  })
  .strict()
  .meta({ id: "LeftoverTaskPreview" });
export const leftoverTaskSourceSchema = z
  .object({
    source: z
      .object({ projectId: id, recordId: id, leftoverItemId: id })
      .strict()
      .nullable(),
  })
  .strict()
  .meta({ id: "LeftoverTaskSource" });
export const leftoverTaskSchemas = {
  LeftoverTaskRequest: {
    schema: leftoverTaskRequestSchema,
    summary: "当前版本稳定遗留转任务与影响集合确认",
    sensitiveFieldPaths: [],
  },
  LeftoverTaskResponse: {
    schema: leftoverTaskResponseSchema,
    summary: "转换结果与已授权任务引用",
    sensitiveFieldPaths: [],
  },
  LeftoverTaskPreview: {
    schema: leftoverTaskPreviewSchema,
    summary: "服务端推导的当前遗留内容和影响继承预览",
    sensitiveFieldPaths: [],
  },
  LeftoverTaskSource: {
    schema: leftoverTaskSourceSchema,
    summary: "跟进任务的当前可读来源记录",
    sensitiveFieldPaths: [],
  },
  LeftoverTaskReplayContext: {
    schema: leftoverTaskResponseSchema
      .omit({
        recordVersion: true,
        recordRowVersion: true,
        leftoverRowVersion: true,
      })
      .meta({ id: "LeftoverTaskReplayContext" }),
    summary: "转换结果的最小资源引用",
    sensitiveFieldPaths: [],
  },
};
export type LeftoverTaskRequest = z.infer<typeof leftoverTaskRequestSchema>;
export type LeftoverTaskResponse = z.infer<typeof leftoverTaskResponseSchema>;
export type LeftoverTaskPreview = z.infer<typeof leftoverTaskPreviewSchema>;
