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
    acceptanceCriteria: z.string().max(50000).optional(),
    tags: z.array(z.string()).max(50).default([]),
  })
  .strict()
  .meta({ id: "FeatureEditRequest" });
export const featureMutationHeadersSchema = z
  .object({ "x-csrf-token": z.string().length(43) })
  .strict()
  .meta({ id: "FeatureMutationHeaders" });
export const featureVersionHeadersSchema = featureMutationHeadersSchema
  .extend({ "if-match": z.string().regex(/^"[1-9][0-9]{0,9}"$/) })
  .meta({ id: "FeatureVersionHeaders" });
/**
 * 功能卡统计：openTaskCount / completedTaskCount 与项目/模块卡同口径，只计该功能下的有效任务
 * （模块级任务通过影响关系计入）；recordCount 只计 status = PUBLISHED 的正式迭代记录，
 * 与功能档案的迭代历史一致。ADR-045 起功能没有归档态，卡片档位由 completedTaskCount 派生。
 */
export const featureStatsSchema = z
  .object({
    openTaskCount: z.number().int().nonnegative(),
    completedTaskCount: z.number().int().nonnegative(),
    recordCount: z.number().int().nonnegative(),
  })
  .strict()
  .meta({ id: "FeatureStats" });

export type FeatureStats = z.infer<typeof featureStatsSchema>;

export const featureItemSchema = z
  .object({
    id,
    projectId: id,
    moduleId: id,
    code: z.string().max(64),
    createdBy: id,
    createdByName: z.string().nullable().optional(),
    tags: z.array(z.string()).max(50),
    name: z.string().min(1).max(500),
    currentBehavior: z.string().max(50000),
    acceptanceCriteria: z.string().max(50000),
    rowVersion: id,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    stats: featureStatsSchema,
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
    summary: "功能列表",
    sensitiveFieldPaths: [],
  },
  FeatureReplayContext: {
    schema: featureReplayContextSchema,
    summary: "功能重放结果资源",
    sensitiveFieldPaths: [],
  },
};
