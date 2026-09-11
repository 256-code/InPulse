import { z } from "zod";

/**
 * F-18 / F-19 记录列表分页（C-006 envelope）：items / nextCursor / hasMore。
 * limit 默认 20、上限 100；cursor 为服务端签名、绑定 actor/命名空间/项目、
 * 15 分钟过期的不透明字符串，客户端不得解析或修改。
 */
export const RECORD_PAGE_LIMIT_DEFAULT = 20;
export const RECORD_PAGE_LIMIT_MAX = 100;
export const RECORD_CURSOR_MAX_LENGTH = 512;

export const recordListCursorSchema = z
  .string()
  .min(1)
  .max(RECORD_CURSOR_MAX_LENGTH)
  .optional();

export const recordListLimitSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(RECORD_PAGE_LIMIT_MAX)
  .optional();
