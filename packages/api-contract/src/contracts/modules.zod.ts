import { z } from "zod";

const id = z.number().int().positive().max(2147483647);
export const moduleProjectPathSchema = z
  .object({ projectId: z.coerce.number().int().positive().max(2147483647) })
  .strict()
  .meta({ id: "ModuleProjectPath" });
export const moduleResourcePathSchema = moduleProjectPathSchema
  .extend({ moduleId: z.coerce.number().int().positive().max(2147483647) })
  .meta({ id: "ModuleResourcePath" });
export const moduleEditRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().max(20000).default(""),
  })
  .strict()
  .meta({ id: "ModuleEditRequest" });
export const moduleArchiveRequestSchema = z
  .object({ reason: z.string().trim().min(1).max(2000) })
  .strict()
  .meta({ id: "ModuleArchiveRequest" });
export const moduleMutationHeadersSchema = z
  .object({ "x-csrf-token": z.string().length(43) })
  .strict()
  .meta({ id: "ModuleMutationHeaders" });
export const moduleVersionHeadersSchema = moduleMutationHeadersSchema
  .extend({ "if-match": z.string().regex(/^"[1-9][0-9]{0,9}"$/) })
  .meta({ id: "ModuleVersionHeaders" });
/**
 * 模块卡统计：activeFeatureCount 只计模块下 status = ACTIVE 的功能；
 * openTaskCount 与项目卡同口径（work_status = TODO，排除 INVALID 与历史来源分支），
 * 统计范围是模块下全部任务（含功能级任务），与模块任务列表一致；
 * completedTaskCount 是同一口径下 work_status = DONE 的任务数，前端据此显示
 * 「未开始」标签（模块内没有已完成任务即未开始）。
 */
export const moduleStatsSchema = z
  .object({
    activeFeatureCount: z.number().int().nonnegative(),
    openTaskCount: z.number().int().nonnegative(),
    completedTaskCount: z.number().int().nonnegative(),
  })
  .strict()
  .meta({ id: "ModuleStats" });

export type ModuleStats = z.infer<typeof moduleStatsSchema>;

export const moduleItemSchema = z
  .object({
    id,
    projectId: id,
    code: z.string().max(64),
    name: z.string().min(1).max(200),
    description: z.string().max(20000),
    kind: z.enum(["NORMAL", "UNCLASSIFIED"]),
    status: z.enum(["ACTIVE", "ARCHIVED"]),
    sortOrder: z.number().int().nonnegative(),
    rowVersion: id,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    archivedAt: z.iso.datetime().nullable(),
    stats: moduleStatsSchema,
  })
  .strict()
  .meta({ id: "ModuleItem" });
export const moduleListResponseSchema = z
  .object({ items: z.array(moduleItemSchema) })
  .strict()
  .meta({ id: "ModuleListResponse" });
export const moduleReplayContextSchema = z
  .object({ projectId: id, moduleId: id })
  .strict()
  .meta({ id: "ModuleReplayContext" });
export type ModuleItem = z.infer<typeof moduleItemSchema>;
export type ModuleEditRequest = z.infer<typeof moduleEditRequestSchema>;

export const moduleSchemas = {
  ModuleProjectPath: {
    schema: moduleProjectPathSchema,
    summary: "模块所属项目参数",
    sensitiveFieldPaths: [],
  },
  ModuleResourcePath: {
    schema: moduleResourcePathSchema,
    summary: "模块真实归属参数",
    sensitiveFieldPaths: [],
  },
  ModuleEditRequest: {
    schema: moduleEditRequestSchema,
    summary: "普通或未分类模块名称描述",
    sensitiveFieldPaths: [],
  },
  ModuleArchiveRequest: {
    schema: moduleArchiveRequestSchema,
    summary: "归档或恢复原因",
    sensitiveFieldPaths: [],
  },
  ModuleMutationHeaders: {
    schema: moduleMutationHeadersSchema,
    summary: "模块创建安全头",
    sensitiveFieldPaths: ["x-csrf-token"],
  },
  ModuleVersionHeaders: {
    schema: moduleVersionHeadersSchema,
    summary: "模块版本与安全头",
    sensitiveFieldPaths: ["x-csrf-token"],
  },
  ModuleItem: {
    schema: moduleItemSchema,
    summary: "模块公开摘要",
    sensitiveFieldPaths: [],
  },
  ModuleListResponse: {
    schema: moduleListResponseSchema,
    summary: "含归档模块的列表",
    sensitiveFieldPaths: [],
  },
  ModuleReplayContext: {
    schema: moduleReplayContextSchema,
    summary: "模块重放结果资源",
    sensitiveFieldPaths: [],
  },
};
