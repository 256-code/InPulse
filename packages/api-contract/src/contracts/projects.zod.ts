import { z } from "zod";

/** 项目编码：与 projects.code CHECK 一致 */
export const projectCodeSchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]{1,31}$/)
  .meta({ id: "ProjectCode" });

const projectPositiveId = z.number().int().positive().max(2147483647);

/** 项目读取路径参数；只接受服务端路由解析后的正整数。 */
export const projectPathSchema = z
  .object({
    projectId: z.coerce.number().int().positive().max(2147483647),
  })
  .strict()
  .meta({ id: "ProjectPath" });

export type ProjectPath = z.infer<typeof projectPathSchema>;

/** 项目公开摘要；包含归档状态与当前活跃成员数，不暴露成员名单或内部字段。 */
export const projectItemSchema = z
  .object({
    id: projectPositiveId,
    code: projectCodeSchema,
    name: z.string().min(1).max(200),
    description: z.string().max(20000),
    status: z.enum(["ACTIVE", "ARCHIVED"]),
    rowVersion: projectPositiveId,
    createdBy: projectPositiveId,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    memberCount: z.number().int().nonnegative(),
  })
  .strict()
  .meta({ id: "ProjectItem" });

export type ProjectItem = z.infer<typeof projectItemSchema>;

/** 当前用户可见项目列表；系统管理员返回全部项目。 */
export const projectListResponseSchema = z
  .object({ items: z.array(projectItemSchema) })
  .strict()
  .meta({ id: "ProjectListResponse" });

export type ProjectListResponse = z.infer<typeof projectListResponseSchema>;

/** 项目详情响应；缺失或无权限统一 404。 */
export const projectDetailResponseSchema = z
  .object({ project: projectItemSchema })
  .strict()
  .meta({ id: "ProjectDetailResponse" });

export type ProjectDetailResponse = z.infer<typeof projectDetailResponseSchema>;

/** 项目成员集合路径；只接受服务端路由解析后的正整数。 */
export const projectMemberCollectionPathSchema = z
  .object({
    projectId: z.coerce.number().int().positive().max(2147483647),
  })
  .strict()
  .meta({ id: "ProjectMemberCollectionPath" });

export type ProjectMemberCollectionPath = z.infer<
  typeof projectMemberCollectionPathSchema
>;

/** 项目成员资源路径。 */
export const projectMemberPathSchema = projectMemberCollectionPathSchema
  .extend({
    userId: z.coerce.number().int().positive().max(2147483647),
  })
  .strict()
  .meta({ id: "ProjectMemberPath" });

export type ProjectMemberPath = z.infer<typeof projectMemberPathSchema>;

/** 项目成员历史记录，包含用户脱敏展示字段与加入/移除时间。 */
export const projectMemberRecordItemSchema = z
  .object({
    membershipId: projectPositiveId,
    projectId: projectPositiveId,
    userId: projectPositiveId,
    name: z.string().min(1).max(200),
    avatarUrl: z.string().max(2048).nullable(),
    status: z.enum(["ACTIVE", "REMOVED"]),
    joinedAt: z.iso.datetime(),
    removedAt: z.iso.datetime().nullable(),
  })
  .strict()
  .meta({ id: "ProjectMemberRecordItem" });

export type ProjectMemberRecordItem = z.infer<
  typeof projectMemberRecordItemSchema
>;

/** 系统管理员成员历史列表。 */
export const projectMembersListResponseSchema = z
  .object({
    items: z.array(projectMemberRecordItemSchema),
  })
  .strict()
  .meta({ id: "ProjectMembersListResponse" });

export type ProjectMembersListResponse = z.infer<
  typeof projectMembersListResponseSchema
>;

/** 添加项目成员请求；目标用户由服务端校验必须为启用状态。 */
export const addProjectMemberRequestSchema = z
  .object({
    userId: projectPositiveId,
  })
  .strict()
  .meta({ id: "AddProjectMemberRequest" });

export type AddProjectMemberRequest = z.infer<
  typeof addProjectMemberRequestSchema
>;

/** 写接口安全头；高风险管理员操作由服务端在同事务内再次校验重认证。 */
export const projectMemberMutationHeadersSchema = z
  .object({
    "x-csrf-token": z.string().min(43).max(43),
  })
  .strict()
  .meta({ id: "ProjectMemberMutationHeaders" });

export type ProjectMemberMutationHeaders = z.infer<
  typeof projectMemberMutationHeadersSchema
>;

/** 项目成员未完成任务读模型；供移除前提示与真实改派参数。 */
export const projectMemberUnfinishedTaskItemSchema = z
  .object({
    taskId: projectPositiveId,
    projectId: projectPositiveId,
    moduleId: projectPositiveId,
    featureId: projectPositiveId.nullable(),
    scopeType: z.enum(["FEATURE", "MODULE"]),
    code: z.string().min(1).max(64),
    title: z.string().min(1).max(500),
    description: z.string().max(50000),
    priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]),
    dueAt: z.iso.datetime().nullable(),
    workStatus: z.literal("TODO"),
    assigneeId: projectPositiveId,
    rowVersion: projectPositiveId,
    impactFeatureIds: z.array(projectPositiveId).default([]),
  })
  .strict()
  .meta({ id: "ProjectMemberUnfinishedTaskItem" });

export type ProjectMemberUnfinishedTaskItem = z.infer<
  typeof projectMemberUnfinishedTaskItemSchema
>;

export const projectMemberUnfinishedTasksResponseSchema = z
  .object({
    items: z.array(projectMemberUnfinishedTaskItemSchema),
  })
  .strict()
  .meta({ id: "ProjectMemberUnfinishedTasksResponse" });

export type ProjectMemberUnfinishedTasksResponse = z.infer<
  typeof projectMemberUnfinishedTasksResponseSchema
>;

/** 单项成员移除时的任务改派；rowVersion 用于防止覆盖并发任务编辑。 */
export const projectMemberReassignmentItemSchema = z
  .object({
    taskId: projectPositiveId,
    moduleId: projectPositiveId,
    featureId: projectPositiveId.nullable(),
    rowVersion: projectPositiveId,
    assigneeId: projectPositiveId,
  })
  .strict()
  .meta({ id: "ProjectMemberReassignmentItem" });

export type ProjectMemberReassignmentItem = z.infer<
  typeof projectMemberReassignmentItemSchema
>;

const defaultReassignments = z
  .array(projectMemberReassignmentItemSchema)
  .max(1000)
  .overwrite((values) =>
    [...new Map(values.map((item) => [item.taskId, item])).values()].sort(
      (a, b) => a.taskId - b.taskId,
    ),
  );

/** 移除成员请求；未完成任务默认保留原负责人并失去继续处理权限。 */
export const removeProjectMemberRequestSchema = z
  .object({
    reassignments: defaultReassignments.default([]),
  })
  .strict()
  .meta({ id: "RemoveProjectMemberRequest" });

export type RemoveProjectMemberRequest = z.infer<
  typeof removeProjectMemberRequestSchema
>;

/** 添加成员成功响应；成员为新增或重新加入后的最新 ACTIVE 历史记录。 */
export const addProjectMemberResponseSchema = z
  .object({
    member: projectMemberRecordItemSchema,
  })
  .strict()
  .meta({ id: "AddProjectMemberResponse" });

export type AddProjectMemberResponse = z.infer<
  typeof addProjectMemberResponseSchema
>;

/** 移除成员成功响应；reassignedTaskIds 为本次已改派任务。 */
export const removeProjectMemberResponseSchema = z
  .object({
    member: projectMemberRecordItemSchema,
    reassignedTaskIds: z.array(projectPositiveId),
    unfinishedTaskCount: z.number().int().nonnegative(),
  })
  .strict()
  .meta({ id: "RemoveProjectMemberResponse" });

export type RemoveProjectMemberResponse = z.infer<
  typeof removeProjectMemberResponseSchema
>;

/** 成员写操作幂等重放的最小结果资源上下文。 */
export const projectMemberReplayContextSchema = z
  .object({
    projectId: projectPositiveId,
    memberUserId: projectPositiveId,
  })
  .strict()
  .meta({ id: "ProjectMemberReplayContext" });

export type ProjectMemberReplayContext = z.infer<
  typeof projectMemberReplayContextSchema
>;

/**
 * 创建项目请求。创建者由服务端从认证 Session 解析，不接收客户端提交的
 * createdBy；memberIds 为可选初始成员（不含创建者），服务端校验其 ACTIVE 状态。
 */
export const createProjectRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    code: projectCodeSchema.optional(),
    description: z.string().max(20000).default(""),
    memberIds: z.array(z.number().int().positive()).max(1000).default([]),
  })
  .strict()
  .meta({ id: "CreateProjectRequest" });

export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

/** CSRF 同步 Token；写接口要求。 */
export const createProjectHeadersSchema = z
  .object({
    "x-csrf-token": z.string().min(43).max(43),
  })
  .strict()
  .meta({ id: "CreateProjectHeaders" });

export type CreateProjectHeaders = z.infer<typeof createProjectHeadersSchema>;

/** 项目成员摘要（幂等重放与响应共享）。 */
export const projectMemberItemSchema = z
  .object({
    userId: z.number().int().positive(),
    status: z.enum(["ACTIVE", "REMOVED"]),
    joinedAt: z.string().min(1).max(64),
  })
  .strict()
  .meta({ id: "ProjectMemberItem" });

export type ProjectMemberItem = z.infer<typeof projectMemberItemSchema>;

/** 创建项目响应（成功状态码 200）。 */
export const createProjectResponseSchema = z
  .object({
    project: z
      .object({
        id: z.number().int().positive(),
        code: projectCodeSchema,
        name: z.string().min(1).max(200),
        description: z.string().max(20000),
        status: z.literal("ACTIVE"),
        rowVersion: z.number().int().positive(),
        createdBy: z.number().int().positive(),
        createdAt: z.string().min(1).max(64),
        updatedAt: z.string().min(1).max(64),
      })
      .strict(),
    members: z.array(projectMemberItemSchema),
    unclassifiedModuleId: z.number().int().positive(),
  })
  .strict()
  .meta({ id: "CreateProjectResponse" });

export type CreateProjectResponse = z.infer<typeof createProjectResponseSchema>;

/** 幂等重放授权上下文：结果资源为新建项目及其成员。 */
export const createProjectReplayContextSchema = z
  .object({
    projectId: z.number().int().positive(),
    actorUserId: z.number().int().positive(),
  })
  .strict()
  .meta({ id: "CreateProjectReplayContext" });

export type CreateProjectReplayContext = z.infer<
  typeof createProjectReplayContextSchema
>;

/**
 * 项目编辑请求；编码创建后不可修改，名称与描述为完整替换值，
 * 服务端以 If-Match 版本做乐观锁并整笔覆盖。
 */
export const projectEditRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().max(20000).default(""),
  })
  .strict()
  .meta({ id: "ProjectEditRequest" });

export type ProjectEditRequest = z.infer<typeof projectEditRequestSchema>;

/** 项目写请求安全头；要求同步 CSRF Token。 */
export const projectMutationHeadersSchema = z
  .object({
    "x-csrf-token": z.string().min(43).max(43),
  })
  .strict()
  .meta({ id: "ProjectMutationHeaders" });

export type ProjectMutationHeaders = z.infer<
  typeof projectMutationHeadersSchema
>;

/** 项目编辑版本头；If-Match 防止覆盖并发编辑。 */
export const projectVersionHeadersSchema = projectMutationHeadersSchema
  .extend({
    "if-match": z.string().regex(/^"[1-9][0-9]{0,9}"$/),
  })
  .meta({ id: "ProjectVersionHeaders" });

export type ProjectVersionHeaders = z.infer<typeof projectVersionHeadersSchema>;

/** 项目写操作幂等重放的最小结果资源上下文。 */
export const projectReplayContextSchema = z
  .object({
    projectId: z.number().int().positive().max(2147483647),
  })
  .strict()
  .meta({ id: "ProjectReplayContext" });

export type ProjectReplayContext = z.infer<typeof projectReplayContextSchema>;

/** 项目归档/恢复原因；两类高风险操作都必须显式填写。 */
export const projectArchiveRequestSchema = z
  .object({
    reason: z.string().trim().min(1).max(2000),
  })
  .strict()
  .meta({ id: "ProjectArchiveRequest" });

export type ProjectArchiveRequest = z.infer<typeof projectArchiveRequestSchema>;

/** 归档前影响预览；只统计当前未完成的真实任务，用于归档提醒。 */
export const projectArchivePreviewResponseSchema = z
  .object({
    projectId: projectPositiveId,
    unfinishedTaskCount: z.number().int().nonnegative(),
  })
  .strict()
  .meta({ id: "ProjectArchivePreviewResponse" });

export type ProjectArchivePreviewResponse = z.infer<
  typeof projectArchivePreviewResponseSchema
>;
