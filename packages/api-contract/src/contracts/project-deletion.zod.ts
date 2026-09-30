import { z } from "zod";

export const PROJECT_DELETION_PAGE_LIMIT_MAX = 50;
export const PROJECT_DELETION_CURSOR_MAX_LENGTH = 512;

/**
 * ADR-050：项目删除记录对全体登录用户可见，但只暴露「谁在何时删除了哪个项目」，
 * 不随删除记录放开已删除项目的正文（模块、功能、任务、迭代记录仍全部不可读）。
 */
export const projectDeletionQueryRequestSchema = z
  .object({
    cursor: z
      .string()
      .min(1)
      .max(PROJECT_DELETION_CURSOR_MAX_LENGTH)
      .optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(PROJECT_DELETION_PAGE_LIMIT_MAX)
      .optional(),
  })
  .strict()
  .meta({ id: "ProjectDeletionQueryRequest" });

export const projectDeletionItemSchema = z
  .object({
    projectId: z.number().int().positive(),
    code: z.string().min(1).max(64),
    name: z.string().min(1).max(200),
    deletedAt: z.string().min(1).max(64),
    deletedBy: z
      .object({
        id: z.number().int().positive(),
        name: z.string().min(1).max(200),
      })
      .strict(),
    // ADR-051：逐条记录给出调用方在当前会话下能否执行还原 / 彻底删除，
    // 由服务端按实时成员关系与全局管理员标记判定；前端只用它决定是否渲染入口，
    // 真正的门禁仍在写路径上重新判定。
    canRestore: z.boolean(),
    canPurge: z.boolean(),
  })
  .strict()
  .meta({ id: "ProjectDeletionItem" });

export const projectDeletionPageSchema = z
  .object({
    items: z
      .array(projectDeletionItemSchema)
      .max(PROJECT_DELETION_PAGE_LIMIT_MAX),
    nextCursor: z
      .string()
      .min(1)
      .max(PROJECT_DELETION_CURSOR_MAX_LENGTH)
      .nullable(),
    hasMore: z.boolean(),
  })
  .strict()
  .meta({ id: "ProjectDeletionPage" });

export type ProjectDeletionQueryRequest = z.infer<
  typeof projectDeletionQueryRequestSchema
>;
export type ProjectDeletionItem = z.infer<typeof projectDeletionItemSchema>;
export type ProjectDeletionPage = z.infer<typeof projectDeletionPageSchema>;
