export const SEARCH_PROJECTION_ENTITY_TYPES = [
  "PROJECT",
  "MODULE",
  "FEATURE",
  "TASK",
  "CHANGE_RECORD",
  "EXTERNAL_LINK",
  "TASK_GROUP",
] as const;

export type SearchProjectionEntityType =
  (typeof SEARCH_PROJECTION_ENTITY_TYPES)[number];

export const SEARCH_PROJECTION_VISIBILITY_SCOPES = [
  "MEMBER",
  "ADMIN_ONLY",
  "HIDDEN",
] as const;

export type SearchProjectionVisibilityScope =
  (typeof SEARCH_PROJECTION_VISIBILITY_SCOPES)[number];
