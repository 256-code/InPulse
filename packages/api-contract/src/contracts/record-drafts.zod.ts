import { z } from "zod";
import {
  RECORD_CURSOR_MAX_LENGTH,
  RECORD_PAGE_LIMIT_MAX,
  recordListCursorSchema,
  recordListLimitSchema,
} from "./record-pagination.zod.js";

const id = z.number().int().positive().max(2147483647);
const pathId = z.coerce.number().int().positive().max(2147483647);
const impactIds = z
  .array(id)
  .max(1000)
  .overwrite((values) => [...new Set(values)].sort((a, b) => a - b));
export const recordDraftContentSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    contextProblem: z.string().trim().min(1).max(50000),
    changeSolution: z.string().trim().min(1).max(50000),
    resultVerification: z.string().trim().min(1).max(50000),
    remainingIssues: z.string().trim().max(50000),
  })
  .strict()
  .meta({ id: "RecordDraftContent" });
export const independentRecordDraftSchema = z
  .discriminatedUnion("scopeType", [
    recordDraftContentSchema.extend({
      scopeType: z.literal("FEATURE"),
      featureId: id,
    }),
    recordDraftContentSchema.extend({
      scopeType: z.literal("MODULE"),
      impactFeatureIds: impactIds,
    }),
  ])
  .meta({ id: "IndependentRecordDraftRequest" });
export const recordDraftItemSchema = recordDraftContentSchema
  .extend({
    id,
    projectId: id,
    moduleId: id,
    featureId: id.nullable(),
    scopeType: z.enum(["FEATURE", "MODULE"]),
    taskId: id.nullable(),
    impactFeatureIds: impactIds,
    handlerId: id,
    authorId: id,
    status: z.literal("DRAFT"),
    code: z.null(),
    currentVersion: z.literal(0),
    publishedAt: z.null(),
    rowVersion: id,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "RecordDraftItem" });
export const recordDraftListQuerySchema = z
  .object({
    cursor: recordListCursorSchema,
    limit: recordListLimitSchema,
  })
  .strict()
  .meta({ id: "RecordDraftListQuery" });
export const recordDraftPageSchema = z
  .object({
    items: z.array(recordDraftItemSchema).max(RECORD_PAGE_LIMIT_MAX),
    nextCursor: z.string().min(1).max(RECORD_CURSOR_MAX_LENGTH).nullable(),
    hasMore: z.boolean(),
  })
  .strict()
  .meta({ id: "RecordDraftPage" });
export type RecordDraftListQuery = z.infer<typeof recordDraftListQuerySchema>;
export type RecordDraftPage = z.infer<typeof recordDraftPageSchema>;
export const recordDraftProjectPathSchema = z
  .object({ projectId: pathId })
  .strict()
  .meta({ id: "RecordDraftProjectPath" });
export const recordDraftCreatePathSchema = recordDraftProjectPathSchema
  .extend({ moduleId: pathId })
  .meta({ id: "RecordDraftCreatePath" });
export const recordDraftResourcePathSchema = recordDraftProjectPathSchema
  .extend({ recordId: pathId })
  .meta({ id: "RecordDraftResourcePath" });
export const recordDraftReplayContextSchema = z
  .object({
    projectId: id,
    recordId: id,
    moduleId: id,
    featureId: id.nullable(),
    taskId: id.nullable(),
    impactFeatureIds: impactIds,
  })
  .strict()
  .meta({ id: "RecordDraftReplayContext" });
export const recordDraftHeadersSchema = z
  .object({ "x-csrf-token": z.string().length(43) })
  .strict()
  .meta({ id: "RecordDraftHeaders" });
export const recordDraftVersionHeadersSchema = recordDraftHeadersSchema
  .extend({ "if-match": z.string().regex(/^"[1-9][0-9]{0,9}"$/) })
  .meta({ id: "RecordDraftVersionHeaders" });
export type RecordDraftContent = z.infer<typeof recordDraftContentSchema>;
export type RecordDraftItem = z.infer<typeof recordDraftItemSchema>;
export type IndependentRecordDraftRequest = z.infer<
  typeof independentRecordDraftSchema
>;
export const recordDraftSchemas = {
  TaskRecordDraftRequest: {
    schema: recordDraftContentSchema
      .extend({ title: z.string().trim().min(1).max(500).nullable() })
      .meta({ id: "TaskRecordDraftRequest" }),
    summary: "来源草稿；空标题由已锁定任务推导",
    sensitiveFieldPaths: [],
  },
  TaskRecordDraftPath: {
    schema: recordDraftCreatePathSchema
      .extend({ taskId: pathId })
      .meta({ id: "TaskRecordDraftPath" }),
    summary: "来源任务真实模块路径",
    sensitiveFieldPaths: [],
  },
  TaskRecordDraftResourcePath: {
    schema: recordDraftCreatePathSchema
      .extend({ taskId: pathId, recordId: pathId })
      .meta({ id: "TaskRecordDraftResourcePath" }),
    summary: "来源任务与草稿",
    sensitiveFieldPaths: [],
  },
  TaskRecordDraftsResponse: {
    schema: z
      .object({
        source: z
          .object({
            taskId: id,
            projectId: id,
            moduleId: id,
            featureId: id.nullable(),
            scopeType: z.enum(["FEATURE", "MODULE"]),
            title: z.string().max(500),
            assigneeId: id,
            workStatus: z.enum(["TODO", "DONE", "CANCELED"]),
            lifecycleStatus: z.enum(["ACTIVE", "ARCHIVED", "INVALID"]),
            rowVersion: id,
            impactFeatureIds: impactIds,
          })
          .strict(),
        items: z.array(recordDraftItemSchema),
      })
      .strict()
      .meta({ id: "TaskRecordDraftsResponse" }),
    summary: "服务端来源上下文及可继续编辑的全部草稿",
    sensitiveFieldPaths: [],
  },
  RecordDraftContent: {
    schema: recordDraftContentSchema,
    summary: "三段式草稿内容",
    sensitiveFieldPaths: [],
  },
  IndependentRecordDraftRequest: {
    schema: independentRecordDraftSchema,
    summary: "独立草稿及待服务端验证的范围",
    sensitiveFieldPaths: [],
  },
  RecordDraftItem: {
    schema: recordDraftItemSchema,
    summary: "未编号的草稿及服务端归属",
    sensitiveFieldPaths: [],
  },
  RecordDraftPage: {
    schema: recordDraftPageSchema,
    summary: "当前有权项目的草稿分页（items/nextCursor/hasMore）",
    sensitiveFieldPaths: [],
  },
  RecordDraftListQuery: {
    schema: recordDraftListQuerySchema,
    summary: "草稿列表签名游标与 limit 1..100 默认 20",
    sensitiveFieldPaths: [],
  },
  RecordDraftProjectPath: {
    schema: recordDraftProjectPathSchema,
    summary: "草稿项目",
    sensitiveFieldPaths: [],
  },
  RecordDraftCreatePath: {
    schema: recordDraftCreatePathSchema,
    summary: "独立草稿模块",
    sensitiveFieldPaths: [],
  },
  RecordDraftResourcePath: {
    schema: recordDraftResourcePathSchema,
    summary: "草稿资源",
    sensitiveFieldPaths: [],
  },
  RecordDraftReplayContext: {
    schema: recordDraftReplayContextSchema,
    summary: "草稿结果资源授权",
    sensitiveFieldPaths: [],
  },
  RecordDraftHeaders: {
    schema: recordDraftHeadersSchema,
    summary: "草稿创建安全头",
    sensitiveFieldPaths: ["x-csrf-token"],
  },
  RecordDraftVersionHeaders: {
    schema: recordDraftVersionHeadersSchema,
    summary: "草稿版本安全头",
    sensitiveFieldPaths: ["x-csrf-token"],
  },
};
