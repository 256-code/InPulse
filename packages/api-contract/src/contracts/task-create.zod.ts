import { z } from "zod";
import { taskEditRequestSchema } from "./tasks.zod.js";
import { moduleEditRequestSchema } from "./modules.zod.js";
import { featureEditRequestSchema } from "./features.zod.js";
const id = z.number().int().positive().max(2147483647);
const existing = z.object({ kind: z.literal("existing"), id }).strict();
export const taskCreateRequestSchema = z
  .object({
    module: z.discriminatedUnion("kind", [
      existing,
      z
        .object({ kind: z.literal("new"), input: moduleEditRequestSchema })
        .strict(),
    ]),
    feature: z
      .discriminatedUnion("kind", [
        existing,
        z
          .object({ kind: z.literal("new"), input: featureEditRequestSchema })
          .strict(),
      ])
      .nullable(),
    task: taskEditRequestSchema,
    impactFeatureIds: z.array(id).max(100).default([]),
  })
  .strict()
  .refine(
    (v) =>
      !(
        v.module.kind === "new" &&
        (v.feature?.kind === "existing" || v.impactFeatureIds.length > 0)
      ),
    { message: "新模块不能引用已有功能" },
  )
  .refine((v) => v.feature === null || v.impactFeatureIds.length === 0, {
    message: "功能级任务不接受影响功能",
  })
  .meta({ id: "TaskCreateRequest" });
export const taskCreateResultSchema = z
  .object({ projectId: id, moduleId: id, featureId: id.nullable(), taskId: id })
  .strict()
  .meta({ id: "TaskCreateResult" });
export type TaskCreateRequest = z.infer<typeof taskCreateRequestSchema>;
export type TaskCreateResult = z.infer<typeof taskCreateResultSchema>;
export const taskCreateSchemas = {
  TaskCreateRequest: {
    schema: taskCreateRequestSchema,
    summary: "任务与自定义归属联合创建",
    sensitiveFieldPaths: [],
  },
  TaskCreateResult: {
    schema: taskCreateResultSchema,
    summary: "创建结果与重放资源",
    sensitiveFieldPaths: [],
  },
};
