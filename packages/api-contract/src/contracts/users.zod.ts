import { z } from "zod";

/** 成员选择接口一次读取的最大活跃用户数；阶段 0 面向 10～300 人规模。 */
export const USER_DIRECTORY_LIMIT = 300;

/**
 * 用户目录条目。只暴露创建项目成员选择所需的公开字段，不返回
 * `loginName`、`email`、`passwordHash` 或停用状态等敏感/内部字段。
 */
export const userDirectoryItemSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string().min(1).max(200),
    avatarUrl: z.string().min(1).max(2048).nullable(),
    isAdmin: z.boolean(),
  })
  .strict()
  .meta({ id: "UserDirectoryItem" });

export type UserDirectoryItem = z.infer<typeof userDirectoryItemSchema>;

/** 用户目录响应；当前纵切片一次返回全部启用用户，不提供搜索或分页。 */
export const userDirectoryResponseSchema = z
  .object({
    items: z.array(userDirectoryItemSchema).max(USER_DIRECTORY_LIMIT),
  })
  .strict()
  .meta({ id: "UserDirectoryResponse" });

export type UserDirectoryResponse = z.infer<typeof userDirectoryResponseSchema>;
