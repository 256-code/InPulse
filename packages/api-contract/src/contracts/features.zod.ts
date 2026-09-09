import { z } from "zod";

const id = z.number().int().positive().max(2147483647);
export const featureCollectionPathSchema = z
  .object({
    projectId: z.coerce.number().int().positive().max(2147483647),
    moduleId: z.coerce.number().int().positive().max(2147483647),
  })
  .strict()
  .meta({ id: "FeatureCollectionPath" });
export const featureResourcePathSchema = featureCollectionPathSchema
  .extend({ featureId: z.coerce.number().int().positive().max(2147483647) })
  .meta({ id: "FeatureResourcePath" });
export const featureEditRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(500),
    currentBehavior: z.string().max(50000).default(""),
    tags: z.array(z.string()).max(50).default([]),
  })
  .strict()
  .meta({ id: "FeatureEditRequest" });
export const featureArchiveRequestSchema = z
  .object({ reason: z.string().trim().min(1).max(2000) })
  .strict()
  .meta({ id: "FeatureArchiveRequest" });
export const featureMutationHeadersSchema = z
  .object({ "x-csrf-token": z.string().length(43) })
  .strict()
  .meta({ id: "FeatureMutationHeaders" });
export const featureVersionHeadersSchema = featureMutationHeadersSchema
  .extend({ "if-match": z.string().regex(/^"[1-9][0-9]{0,9}"$/) })
  .meta({ id: "FeatureVersionHeaders" });
export const featureItemSchema = z
  .object({
    id,
    projectId: id,
    moduleId: id,
    code: z.string().max(64),
    createdBy: id,
    tags: z.array(z.string()).max(50),
    name: z.string().min(1).max(500),
    currentBehavior: z.string().max(50000),
    status: z.enum(["ACTIVE", "ARCHIVED"]),
    rowVersion: id,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    archivedAt: z.iso.datetime().nullable(),
  })
  .strict()
  .meta({ id: "FeatureItem" });
export const featureListResponseSchema = z
  .object({ items: z.array(featureItemSchema) })
  .strict()
  .meta({ id: "FeatureListResponse" });
export const featureReplayContextSchema = z
  .object({ projectId: id, moduleId: id, featureId: id })
  .strict()
  .meta({ id: "FeatureReplayContext" });
export type FeatureItem = z.infer<typeof featureItemSchema>;
export type FeatureEditRequest = z.infer<typeof featureEditRequestSchema>;

export const featureSimilarQuerySchema = z
  .object({ q: z.string().trim().min(2).max(200) })
  .strict()
  .meta({ id: "FeatureSimilarQuery" });
export const featureSchemas = {
  FeatureSimilarQuery: {
    schema: featureSimilarQuerySchema,
    summary: "当前项目关键词候选",
    sensitiveFieldPaths: [],
  },
  FeatureCollectionPath: {
    schema: featureCollectionPathSchema,
    summary: "功能所属项目参数",
    sensitiveFieldPaths: [],
  },
  FeatureResourcePath: {
    schema: featureResourcePathSchema,
    summary: "功能真实归属参数",
    sensitiveFieldPaths: [],
  },
  FeatureEditRequest: {
    schema: featureEditRequestSchema,
    summary: "功能名称、当前说明与标签",
    sensitiveFieldPaths: [],
  },
  FeatureArchiveRequest: {
    schema: featureArchiveRequestSchema,
    summary: "归档或恢复原因",
    sensitiveFieldPaths: [],
  },
  FeatureMutationHeaders: {
    schema: featureMutationHeadersSchema,
    summary: "功能创建安全头",
    sensitiveFieldPaths: ["x-csrf-token"],
  },
  FeatureVersionHeaders: {
    schema: featureVersionHeadersSchema,
    summary: "功能版本与安全头",
    sensitiveFieldPaths: ["x-csrf-token"],
  },
  FeatureItem: {
    schema: featureItemSchema,
    summary: "功能公开摘要",
    sensitiveFieldPaths: [],
  },
  FeatureListResponse: {
    schema: featureListResponseSchema,
    summary: "含归档功能的列表",
    sensitiveFieldPaths: [],
  },
  FeatureReplayContext: {
    schema: featureReplayContextSchema,
    summary: "功能重放结果资源",
    sensitiveFieldPaths: [],
  },
};
