import { z } from "zod";

/** 项目编码：与 projects.code CHECK 一致 */
export const projectCodeSchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]{1,31}$/)
  .meta({ id: "ProjectCode" });

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
