import { z } from "zod";
const id = z.number().int().positive().max(2147483647);
export const externalLinkTargetTypeSchema = z.enum([
  "PROJECT",
  "FEATURE",
  "TASK",
  "CHANGE_RECORD",
]);
export const externalLinkTargetPathSchema = z
  .object({
    targetType: externalLinkTargetTypeSchema,
    targetId: z.coerce.number().pipe(id),
  })
  .strict()
  .meta({ id: "ExternalLinkTargetPath" });
export const externalLinkItemSchema = z
  .object({
    id,
    projectId: id,
    normalizedUrl: z.string().max(2048),
    kind: z.enum(["ISSUE", "PULL_REQUEST", "COMMIT", "OTHER"]),
    label: z.string().max(500),
    repository: z.string().nullable(),
    externalNumber: z.string().nullable(),
    externalSha: z.string().nullable(),
    releaseTag: z.string().nullable(),
  })
  .strict()
  .meta({ id: "ExternalLinkItem" });
export const externalLinkResultSchema = z
  .object({
    projectId: id,
    targetType: externalLinkTargetTypeSchema,
    targetId: id,
    linkId: id,
    rowVersion: id,
  })
  .strict()
  .meta({ id: "ExternalLinkResult" });
export const externalLinkSchemas = {
  ExternalLinkTargetPath: {
    schema: externalLinkTargetPathSchema,
    summary: "目标类型与真实资源ID",
    sensitiveFieldPaths: [],
  },
  ExternalLinkResourcePath: {
    schema: externalLinkTargetPathSchema
      .extend({ linkId: z.coerce.number().pipe(id) })
      .meta({ id: "ExternalLinkResourcePath" }),
    summary: "目标与当前关联",
    sensitiveFieldPaths: [],
  },
  ExternalLinkRequest: {
    schema: z
      .object({ url: z.string().trim().min(1).max(2048) })
      .strict()
      .meta({ id: "ExternalLinkRequest" }),
    summary: "用户提交的GitHub链接",
    sensitiveFieldPaths: [],
  },
  ExternalLinkItem: {
    schema: externalLinkItemSchema,
    summary: "仅本地路径派生的信息",
    sensitiveFieldPaths: [],
  },
  ExternalLinkList: {
    schema: z
      .object({
        projectId: id,
        rowVersion: id,
        writable: z.boolean(),
        items: z.array(externalLinkItemSchema),
      })
      .strict()
      .meta({ id: "ExternalLinkList" }),
    summary: "当前关联与目标版本",
    sensitiveFieldPaths: [],
  },
  ExternalLinkResult: {
    schema: externalLinkResultSchema,
    summary: "最小变更结果",
    sensitiveFieldPaths: [],
  },
  ExternalLinkReplayContext: {
    schema: externalLinkResultSchema
      .omit({ rowVersion: true })
      .meta({ id: "ExternalLinkReplayContext" }),
    summary: "重放最小资源引用",
    sensitiveFieldPaths: [],
  },
};
export type ExternalLinkTargetType = z.infer<
  typeof externalLinkTargetTypeSchema
>;
export type ExternalLinkItem = z.infer<typeof externalLinkItemSchema>;
