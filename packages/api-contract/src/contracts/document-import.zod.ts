import { z } from "zod";

const id = z.number().int().positive().max(2147483647);

/**
 * 文档导入的规模上限（ADR-064）。文档按字符计数，UTF-8 最坏约 600 KiB，
 * 落在 API 与网关 1 MiB JSON 传输上限内；实体上限约束单事务写入规模。
 */
export const DOCUMENT_IMPORT_MAX_TEXT_LENGTH = 200_000;
export const DOCUMENT_IMPORT_MAX_MODULES = 100;
export const DOCUMENT_IMPORT_MAX_FEATURES = 500;
export const DOCUMENT_IMPORT_MAX_TASKS = 500;
export const DOCUMENT_IMPORT_MAX_TOTAL_ENTITIES = 1_000;
export const DOCUMENT_IMPORT_TEMPLATE_VERSION = "1";
export const DOCUMENT_IMPORT_MAX_MEMBERS = 300;

const digest = z
  .string()
  .regex(/^[0-9a-f]{64}$/)
  .describe("文档规范化文本（去 BOM、CRLF→LF）的 SHA-256 十六进制摘要");

const documentText = z
  .string()
  .min(1)
  .max(DOCUMENT_IMPORT_MAX_TEXT_LENGTH)
  .describe("固定模板文档原文（UTF-8）");

/** 两种预览入口共用的请求体：只含文档原文。 */
export const projectDocumentImportPreviewRequestSchema = z
  .object({ document: documentText })
  .strict()
  .meta({ id: "ProjectDocumentImportPreviewRequest" });

/** 两种执行入口共用的请求体：文档原文 + 预览摘要，摘要不一致返回 409。 */
export const projectDocumentImportRequestSchema = z
  .object({ document: documentText, expectedDigest: digest })
  .strict()
  .meta({ id: "ProjectDocumentImportRequest" });

/** 行级问题；ERROR 阻止执行，WARNING 允许执行但需前端确认。 */
export const documentImportIssueSchema = z
  .object({
    severity: z.enum(["ERROR", "WARNING"]),
    line: z.number().int().min(1).max(1_000_000),
    code: z.string().min(1).max(100),
    message: z.string().min(1).max(2_000),
  })
  .strict()
  .meta({ id: "DocumentImportIssue" });

/** 负责人令牌解析结果；token 为文档中的原文，未解析时不产生条目。 */
export const documentImportMemberRefSchema = z
  .object({
    token: z.string().min(1).max(200),
    userId: id,
    name: z.string().min(1).max(200),
  })
  .strict()
  .meta({ id: "DocumentImportMemberRef" });

/** 模块计划项：CREATE 新建，REUSE 复用项目内同名模块（不覆盖任何字段）。 */
export const documentImportModulePlanSchema = z
  .object({
    line: z.number().int().min(1),
    name: z.string().min(1).max(200),
    action: z.enum(["CREATE", "REUSE"]),
    moduleId: id.nullable(),
  })
  .strict()
  .meta({ id: "DocumentImportModulePlan" });

/** 功能计划项；REUSE 表示复用同模块内唯一同名功能。 */
export const documentImportFeaturePlanSchema = z
  .object({
    line: z.number().int().min(1),
    moduleName: z.string().min(1).max(200),
    name: z.string().min(1).max(500),
    action: z.enum(["CREATE", "REUSE"]),
    featureId: id.nullable(),
  })
  .strict()
  .meta({ id: "DocumentImportFeaturePlan" });

/** 任务计划项；全部任务一律新建。 */
export const documentImportTaskPlanSchema = z
  .object({
    line: z.number().int().min(1),
    scope: z.enum(["FEATURE", "MODULE"]),
    moduleName: z.string().min(1).max(200),
    featureName: z.string().min(1).max(500).nullable(),
    title: z.string().min(1).max(500),
    assignees: z.array(documentImportMemberRefSchema).min(1).max(20),
    priority: z.enum(["NORMAL", "HIGH", "URGENT"]),
    dueAt: z.iso.datetime().nullable(),
  })
  .strict()
  .meta({ id: "DocumentImportTaskPlan" });
/** 整项目导入模式（模式 B）解析出的项目段；模式 A 该字段为 null。 */
export const documentImportProjectPlanSchema = z
  .object({
    name: z.string().min(1).max(200),
    code: z.string().min(2).max(32),
    description: z.string().max(20_000),
    codeAvailable: z.boolean(),
    /** 文档初始成员与任务负责人解析去重后的成员集合（不含创建者）。 */
    members: z
      .array(documentImportMemberRefSchema)
      .max(DOCUMENT_IMPORT_MAX_MEMBERS),
  })
  .strict()
  .meta({ id: "DocumentImportProjectPlan" });

export const documentImportSummarySchema = z
  .object({
    moduleCount: z
      .number()
      .int()
      .nonnegative()
      .max(DOCUMENT_IMPORT_MAX_MODULES),
    featureCount: z
      .number()
      .int()
      .nonnegative()
      .max(DOCUMENT_IMPORT_MAX_FEATURES),
    taskCount: z.number().int().nonnegative().max(DOCUMENT_IMPORT_MAX_TASKS),
    moduleCreateCount: z.number().int().nonnegative(),
    moduleReuseCount: z.number().int().nonnegative(),
    featureCreateCount: z.number().int().nonnegative(),
    featureReuseCount: z.number().int().nonnegative(),
    taskCreateCount: z.number().int().nonnegative(),
    /** 整项目导入将自动加入的成员数（不含创建者）；项目内导入恒为 0。 */
    memberAddCount: z.number().int().nonnegative(),
  })
  .strict()
  .meta({ id: "DocumentImportSummary" });

/** 同一摘要文档的既有导入批次；非 null 时执行将返回 409。 */
export const documentImportDuplicateSchema = z
  .object({
    projectId: id,
    importedAt: z.iso.datetime(),
    actorName: z.string().min(1).max(200),
  })
  .strict()
  .meta({ id: "DocumentImportDuplicate" });

/** 两种预览入口共用的响应：计划、问题清单与摘要信息。 */
export const projectDocumentImportPreviewResponseSchema = z
  .object({
    digest,
    templateVersion: z.literal(DOCUMENT_IMPORT_TEMPLATE_VERSION),
    project: documentImportProjectPlanSchema.nullable(),
    summary: documentImportSummarySchema,
    modules: z
      .array(documentImportModulePlanSchema)
      .max(DOCUMENT_IMPORT_MAX_MODULES),
    features: z
      .array(documentImportFeaturePlanSchema)
      .max(DOCUMENT_IMPORT_MAX_FEATURES),
    tasks: z.array(documentImportTaskPlanSchema).max(DOCUMENT_IMPORT_MAX_TASKS),
    issues: z.array(documentImportIssueSchema).max(5_000),
    canApply: z.boolean(),
    duplicate: documentImportDuplicateSchema.nullable(),
  })
  .strict()
  .meta({ id: "ProjectDocumentImportPreviewResponse" });

export const documentImportResultCountsSchema = z
  .object({
    modules: z.number().int().nonnegative(),
    features: z.number().int().nonnegative(),
    tasks: z.number().int().nonnegative(),
    reusedModules: z.number().int().nonnegative(),
    reusedFeatures: z.number().int().nonnegative(),
    addedMembers: z.number().int().nonnegative(),
  })
  .strict()
  .meta({ id: "DocumentImportResultCounts" });

export const documentImportResultModuleSchema = z
  .object({ id, code: z.string().min(2).max(64) })
  .strict()
  .meta({ id: "DocumentImportResultModule" });

export const documentImportResultFeatureSchema = z
  .object({ id, code: z.string().min(2).max(64), moduleId: id })
  .strict()
  .meta({ id: "DocumentImportResultFeature" });

export const documentImportResultTaskSchema = z
  .object({
    id,
    code: z.string().min(2).max(64),
    moduleId: id,
    featureId: id.nullable(),
    scopeType: z.enum(["FEATURE", "MODULE"]),
  })
  .strict()
  .meta({ id: "DocumentImportResultTask" });
/** 两种执行入口共用的响应：创建结果与重放所需的最小资源引用。 */
export const projectDocumentImportResultSchema = z
  .object({
    projectId: id,
    projectCode: z.string().min(2).max(32),
    digest,
    counts: documentImportResultCountsSchema,
    modules: z
      .array(documentImportResultModuleSchema)
      .max(DOCUMENT_IMPORT_MAX_MODULES),
    features: z
      .array(documentImportResultFeatureSchema)
      .max(DOCUMENT_IMPORT_MAX_FEATURES),
    tasks: z
      .array(documentImportResultTaskSchema)
      .max(DOCUMENT_IMPORT_MAX_TASKS),
  })
  .strict()
  .meta({ id: "ProjectDocumentImportResult" });

/** 幂等重放授权上下文：结果资源全部为本次新建/复用的稳定 ID。 */
export const projectDocumentImportReplayContextSchema = z
  .object({
    projectId: id,
    moduleIds: z.array(id).max(DOCUMENT_IMPORT_MAX_MODULES),
    featureIds: z.array(id).max(DOCUMENT_IMPORT_MAX_FEATURES),
    taskIds: z.array(id).max(DOCUMENT_IMPORT_MAX_TASKS),
  })
  .strict()
  .meta({ id: "ProjectDocumentImportReplayContext" });

export type ProjectDocumentImportPreviewRequest = z.infer<
  typeof projectDocumentImportPreviewRequestSchema
>;
export type ProjectDocumentImportRequest = z.infer<
  typeof projectDocumentImportRequestSchema
>;
export type ProjectDocumentImportPreviewResponse = z.infer<
  typeof projectDocumentImportPreviewResponseSchema
>;
export type ProjectDocumentImportResult = z.infer<
  typeof projectDocumentImportResultSchema
>;
export type ProjectDocumentImportReplayContext = z.infer<
  typeof projectDocumentImportReplayContextSchema
>;
export type DocumentImportIssue = z.infer<typeof documentImportIssueSchema>;
export type DocumentImportMemberRef = z.infer<
  typeof documentImportMemberRefSchema
>;
export type DocumentImportModulePlan = z.infer<
  typeof documentImportModulePlanSchema
>;
export type DocumentImportFeaturePlan = z.infer<
  typeof documentImportFeaturePlanSchema
>;
export type DocumentImportTaskPlan = z.infer<
  typeof documentImportTaskPlanSchema
>;
export type DocumentImportProjectPlan = z.infer<
  typeof documentImportProjectPlanSchema
>;
export type DocumentImportSummary = z.infer<typeof documentImportSummarySchema>;
export type DocumentImportDuplicate = z.infer<
  typeof documentImportDuplicateSchema
>;

export const documentImportSchemas = {
  ProjectDocumentImportPreviewRequest: {
    schema: projectDocumentImportPreviewRequestSchema,
    summary: "文档导入预览请求：固定模板原文",
    sensitiveFieldPaths: [],
  },
  ProjectDocumentImportRequest: {
    schema: projectDocumentImportRequestSchema,
    summary: "文档导入执行请求：原文与预览摘要",
    sensitiveFieldPaths: [],
  },
  ProjectDocumentImportPreviewResponse: {
    schema: projectDocumentImportPreviewResponseSchema,
    summary: "文档导入预览：计划、问题清单与重复提示",
    sensitiveFieldPaths: [],
  },
  ProjectDocumentImportResult: {
    schema: projectDocumentImportResultSchema,
    summary: "文档导入结果：创建资源 ID/编号与计数",
    sensitiveFieldPaths: [],
  },
  ProjectDocumentImportReplayContext: {
    schema: projectDocumentImportReplayContextSchema,
    summary: "文档导入重放资源引用",
    sensitiveFieldPaths: [],
  },
  DocumentImportIssue: {
    schema: documentImportIssueSchema,
    summary: "文档导入行级问题",
    sensitiveFieldPaths: [],
  },
  DocumentImportMemberRef: {
    schema: documentImportMemberRefSchema,
    summary: "负责人/成员令牌解析结果",
    sensitiveFieldPaths: [],
  },
  DocumentImportModulePlan: {
    schema: documentImportModulePlanSchema,
    summary: "模块计划项",
    sensitiveFieldPaths: [],
  },
  DocumentImportFeaturePlan: {
    schema: documentImportFeaturePlanSchema,
    summary: "功能计划项",
    sensitiveFieldPaths: [],
  },
  DocumentImportTaskPlan: {
    schema: documentImportTaskPlanSchema,
    summary: "任务计划项",
    sensitiveFieldPaths: [],
  },
  DocumentImportProjectPlan: {
    schema: documentImportProjectPlanSchema,
    summary: "整项目导入的项目段计划",
    sensitiveFieldPaths: [],
  },
  DocumentImportSummary: {
    schema: documentImportSummarySchema,
    summary: "文档导入计划计数",
    sensitiveFieldPaths: [],
  },
  DocumentImportDuplicate: {
    schema: documentImportDuplicateSchema,
    summary: "同摘要文档的既有导入批次",
    sensitiveFieldPaths: [],
  },
  DocumentImportResultCounts: {
    schema: documentImportResultCountsSchema,
    summary: "文档导入结果计数",
    sensitiveFieldPaths: [],
  },
  DocumentImportResultModule: {
    schema: documentImportResultModuleSchema,
    summary: "结果中的模块引用",
    sensitiveFieldPaths: [],
  },
  DocumentImportResultFeature: {
    schema: documentImportResultFeatureSchema,
    summary: "结果中的功能引用",
    sensitiveFieldPaths: [],
  },
  DocumentImportResultTask: {
    schema: documentImportResultTaskSchema,
    summary: "结果中的任务引用",
    sensitiveFieldPaths: [],
  },
} as const;
