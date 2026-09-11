import { z } from "zod";

export const AUDIT_LOG_PAGE_LIMIT_MAX = 100;
export const AUDIT_LOG_PAGE_LIMIT_DEFAULT = 50;
export const AUDIT_LOG_CURSOR_MAX_LENGTH = 256;

/** 链 ID：SYSTEM 链或 PROJECT:<id> 链（技术设计 7 / F-08）。 */
export const AUDIT_CHAIN_ID_MAX_LENGTH = 100;

export const auditActorTypeSchema = z.enum(["USER", "SYSTEM"]);

/**
 * 原始审计查询参数（F-08 步骤 4）。不传 projectId 读 SYSTEM 链，传 projectId
 * 读 PROJECT:<id> 链；action 精确匹配动作码；from/to 为半开区间 [from, to)，
 * 必须带时区偏移；cursor 为服务端签名、绑定操作者与查询条件的不透明字符串，
 * 客户端不得解析或修改；limit 默认 50、最大 100。
 */
export const auditLogQueryRequestSchema = z
  .object({
    projectId: z.coerce.number().int().positive().optional(),
    action: z.string().min(1).max(200).optional(),
    actorId: z.coerce.number().int().positive().optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    cursor: z.string().min(1).max(AUDIT_LOG_CURSOR_MAX_LENGTH).optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(AUDIT_LOG_PAGE_LIMIT_MAX)
      .optional(),
  })
  .strict()
  .meta({ id: "AuditLogQueryRequest" });

export type AuditLogQueryRequest = z.infer<typeof auditLogQueryRequestSchema>;

const hashHex = z.string().regex(/^[0-9a-f]{64}$/);

/** 原始审计条目：只对系统管理员可见，字段与 audit_logs 列一一对应。 */
export const auditLogItemSchema = z
  .object({
    chainId: z.string().min(1).max(AUDIT_CHAIN_ID_MAX_LENGTH),
    sequenceNo: z.number().int().positive(),
    projectId: z.number().int().positive().nullable(),
    actorType: auditActorTypeSchema,
    actorId: z.number().int().positive().nullable(),
    action: z.string().min(1).max(200),
    targetType: z.string().min(1).max(100),
    targetId: z.string().min(1).max(200).nullable(),
    eventPayload: z.record(z.string(), z.unknown()),
    requestId: z.string().min(1).max(64),
    clientRequestId: z.string().min(1).max(64).nullable(),
    ipAddress: z.string().min(1).max(64).nullable(),
    userAgent: z.string().min(1).max(1000).nullable(),
    occurredAt: z.iso.datetime(),
    prevHash: hashHex,
    recordHash: hashHex,
    keyVersion: z.number().int().positive(),
    canonicalVersion: z.string().min(1).max(20),
  })
  .strict()
  .meta({ id: "AuditLogItem" });

export type AuditLogItem = z.infer<typeof auditLogItemSchema>;

/** 原始审计分页 envelope，与 getSearch 同一约定：items/nextCursor/hasMore。 */
export const auditLogPageSchema = z
  .object({
    items: z.array(auditLogItemSchema).max(AUDIT_LOG_PAGE_LIMIT_MAX),
    nextCursor: z.string().min(1).max(AUDIT_LOG_CURSOR_MAX_LENGTH).nullable(),
    hasMore: z.boolean(),
  })
  .strict()
  .meta({ id: "AuditLogPage" });

export type AuditLogPage = z.infer<typeof auditLogPageSchema>;
