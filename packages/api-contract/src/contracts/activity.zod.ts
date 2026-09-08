import { z } from "zod";

export const ACTIVITY_PAGE_LIMIT_MAX = 50;
export const ACTIVITY_CURSOR_MAX_LENGTH = 512;

export const activitySourceEntityTypeSchema = z.enum([
  "PROJECT",
  "MODULE",
  "FEATURE",
  "TASK",
  "CHANGE_RECORD",
  "EXTERNAL_LINK",
  "TASK_GROUP",
  "LEFTOVER_ITEM",
]);

const booleanField = z.preprocess((value) => {
  if (value === true || value === "true") {
    return true;
  }
  if (value === false || value === "false") {
    return false;
  }
  return undefined;
}, z.boolean());

export const activityPathSchema = z
  .object({
    projectId: z.coerce.number().int().positive(),
  })
  .strict()
  .meta({ id: "ActivityPath" });

export const activityQueryRequestSchema = z
  .object({
    cursor: z.string().min(1).max(ACTIVITY_CURSOR_MAX_LENGTH).optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(ACTIVITY_PAGE_LIMIT_MAX)
      .optional(),
    includeAdminOnly: booleanField.optional(),
  })
  .strict()
  .meta({ id: "ActivityQueryRequest" });

export const activityItemSchema = z
  .object({
    id: z.string().min(1).max(80),
    projectId: z.number().int().positive(),
    sourceEntityType: activitySourceEntityTypeSchema,
    sourceEntityId: z.number().int().positive(),
    activityType: z.string().min(1).max(100),
    actorId: z.number().int().positive().nullable(),
    summary: z.string().min(1).max(1000),
    occurredAt: z.string().min(1).max(64),
  })
  .strict()
  .meta({ id: "ActivityItem" });

export const activityPageSchema = z
  .object({
    items: z.array(activityItemSchema).max(ACTIVITY_PAGE_LIMIT_MAX),
    nextCursor: z.string().min(1).max(ACTIVITY_CURSOR_MAX_LENGTH).nullable(),
    hasMore: z.boolean(),
  })
  .strict()
  .meta({ id: "ActivityPage" });

export type ActivityPath = z.infer<typeof activityPathSchema>;
export type ActivityQueryRequest = z.infer<typeof activityQueryRequestSchema>;
export type ActivityItem = z.infer<typeof activityItemSchema>;
export type ActivityPage = z.infer<typeof activityPageSchema>;
