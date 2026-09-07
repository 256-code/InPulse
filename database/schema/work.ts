import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { users } from "./identity.js";
import { projects } from "./projects.js";
import { appSchema } from "./shared.js";

const timestamptz = (name: string) =>
  timestamp(name, { mode: "date", withTimezone: true });

export const modules = appSchema.table(
  "modules",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    projectId: integer("project_id").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    kind: text("kind").notNull().default("NORMAL"),
    status: text("status").notNull().default("ACTIVE"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdBy: integer("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    rowVersion: integer("row_version").notNull().default(1),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
    archivedAt: timestamptz("archived_at"),
  },
  (table) => [
    unique("modules_id_project_unique").on(table.id, table.projectId),
    foreignKey({
      name: "modules_project_fk",
      columns: [table.projectId],
      foreignColumns: [projects.id],
    }).onDelete("restrict"),
    uniqueIndex("modules_name_project_unique").on(
      table.projectId,
      sql.raw("lower(btrim(name))"),
    ),
    uniqueIndex("modules_one_unclassified_unique")
      .on(table.projectId)
      .where(sql.raw("kind = 'UNCLASSIFIED'")),
    index("modules_project_order_idx").on(
      table.projectId,
      table.sortOrder,
      table.id,
    ),
    check(
      "modules_name_check",
      sql.raw("length(btrim(name)) BETWEEN 1 AND 200"),
    ),
    check("modules_description_check", sql.raw("length(description) <= 20000")),
    check("modules_kind_check", sql.raw("kind IN ('NORMAL', 'UNCLASSIFIED')")),
    check("modules_status_check", sql.raw("status IN ('ACTIVE', 'ARCHIVED')")),
    check("modules_sort_order_check", sql.raw("sort_order >= 0")),
    check("modules_row_version_check", sql.raw("row_version > 0")),
    check(
      "modules_archive_state_check",
      sql.raw(
        "(status = 'ACTIVE' AND archived_at IS NULL) OR (status = 'ARCHIVED' AND archived_at IS NOT NULL)",
      ),
    ),
  ],
);

export const features = appSchema.table(
  "features",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    projectId: integer("project_id").notNull(),
    moduleId: integer("module_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    currentBehavior: text("current_behavior").notNull().default(""),
    tags: text("tags").array().notNull().default(sql.raw("'{}'::text[]")),
    status: text("status").notNull().default("ACTIVE"),
    createdBy: integer("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    rowVersion: integer("row_version").notNull().default(1),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
    archivedAt: timestamptz("archived_at"),
  },
  (table) => [
    unique("features_project_code_unique").on(table.projectId, table.code),
    unique("features_id_project_unique").on(table.id, table.projectId),
    unique("features_id_module_project_unique").on(
      table.id,
      table.moduleId,
      table.projectId,
    ),
    foreignKey({
      name: "features_module_project_fk",
      columns: [table.moduleId, table.projectId],
      foreignColumns: [modules.id, modules.projectId],
    }).onDelete("restrict"),
    index("features_module_status_idx").on(
      table.projectId,
      table.moduleId,
      table.status,
      table.id,
    ),
    check(
      "features_code_check",
      sql.raw(
        "code ~ '^[A-Z][A-Z0-9_]{1,31}-F-[1-9][0-9]*$' AND length(code) <= 64",
      ),
    ),
    check(
      "features_name_check",
      sql.raw("length(btrim(name)) BETWEEN 1 AND 500"),
    ),
    check(
      "features_behavior_check",
      sql.raw("length(current_behavior) <= 50000"),
    ),
    check(
      "features_tags_check",
      sql.raw("cardinality(tags) <= 50 AND array_position(tags, NULL) IS NULL"),
    ),
    check("features_status_check", sql.raw("status IN ('ACTIVE', 'ARCHIVED')")),
    check("features_row_version_check", sql.raw("row_version > 0")),
    check(
      "features_archive_state_check",
      sql.raw(
        "(status = 'ACTIVE' AND archived_at IS NULL) OR (status = 'ARCHIVED' AND archived_at IS NOT NULL)",
      ),
    ),
  ],
);

export const tasks = appSchema.table(
  "tasks",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    projectId: integer("project_id").notNull(),
    moduleId: integer("module_id").notNull(),
    featureId: integer("feature_id"),
    scopeType: text("scope_type").notNull(),
    code: text("code").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    assigneeId: integer("assignee_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    creatorId: integer("creator_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    priority: text("priority").notNull().default("NORMAL"),
    workStatus: text("work_status").notNull().default("TODO"),
    lifecycleStatus: text("lifecycle_status").notNull().default("ACTIVE"),
    completionNote: text("completion_note"),
    completedAt: timestamptz("completed_at"),
    dueAt: timestamptz("due_at"),
    rowVersion: integer("row_version").notNull().default(1),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (table) => [
    unique("tasks_project_code_unique").on(table.projectId, table.code),
    unique("tasks_id_project_unique").on(table.id, table.projectId),
    unique("tasks_id_module_project_unique").on(
      table.id,
      table.moduleId,
      table.projectId,
    ),
    foreignKey({
      name: "tasks_module_project_fk",
      columns: [table.moduleId, table.projectId],
      foreignColumns: [modules.id, modules.projectId],
    }).onDelete("restrict"),
    foreignKey({
      name: "tasks_feature_module_project_fk",
      columns: [table.featureId, table.moduleId, table.projectId],
      foreignColumns: [features.id, features.moduleId, features.projectId],
    }).onDelete("restrict"),
    index("tasks_project_status_idx").on(
      table.projectId,
      table.lifecycleStatus,
      table.workStatus,
      table.id,
    ),
    index("tasks_assignee_status_idx").on(
      table.assigneeId,
      table.workStatus,
      table.id,
    ),
    check("tasks_scope_check", sql.raw("scope_type IN ('FEATURE', 'MODULE')")),
    check(
      "tasks_scope_feature_check",
      sql.raw(
        "(scope_type = 'FEATURE' AND feature_id IS NOT NULL) OR (scope_type = 'MODULE' AND feature_id IS NULL)",
      ),
    ),
    check(
      "tasks_code_check",
      sql.raw(
        "code ~ '^[A-Z][A-Z0-9_]{1,31}-T-[1-9][0-9]*$' AND length(code) <= 64",
      ),
    ),
    check(
      "tasks_title_check",
      sql.raw("length(btrim(title)) BETWEEN 1 AND 500"),
    ),
    check("tasks_description_check", sql.raw("length(description) <= 50000")),
    check(
      "tasks_priority_check",
      sql.raw("priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')"),
    ),
    check(
      "tasks_work_status_check",
      sql.raw("work_status IN ('TODO', 'DONE', 'CANCELED')"),
    ),
    check(
      "tasks_lifecycle_status_check",
      sql.raw("lifecycle_status IN ('ACTIVE', 'ARCHIVED', 'INVALID')"),
    ),
    check(
      "tasks_completion_note_check",
      sql.raw(
        "completion_note IS NULL OR length(btrim(completion_note)) BETWEEN 1 AND 10000",
      ),
    ),
    check(
      "tasks_completion_state_check",
      sql.raw(
        "(work_status = 'DONE' AND completed_at IS NOT NULL) OR (work_status <> 'DONE' AND completed_at IS NULL)",
      ),
    ),
    check("tasks_row_version_check", sql.raw("row_version > 0")),
  ],
);

export const taskFeatureImpacts = appSchema.table(
  "task_feature_impacts",
  {
    taskId: integer("task_id").notNull(),
    featureId: integer("feature_id").notNull(),
    moduleId: integer("module_id").notNull(),
    projectId: integer("project_id").notNull(),
    relationType: text("relation_type").notNull().default("IMPACT"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "task_feature_impacts_pk",
      columns: [table.taskId, table.featureId],
    }),
    foreignKey({
      name: "task_feature_impacts_task_fk",
      columns: [table.taskId, table.moduleId, table.projectId],
      foreignColumns: [tasks.id, tasks.moduleId, tasks.projectId],
    }).onDelete("restrict"),
    foreignKey({
      name: "task_feature_impacts_feature_fk",
      columns: [table.featureId, table.moduleId, table.projectId],
      foreignColumns: [features.id, features.moduleId, features.projectId],
    }).onDelete("restrict"),
    check(
      "task_feature_impacts_type_check",
      sql.raw("relation_type = 'IMPACT'"),
    ),
  ],
);

export const taskStatusHistory = appSchema.table(
  "task_status_history",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedByDefaultAsIdentity(),
    taskId: integer("task_id").notNull(),
    projectId: integer("project_id").notNull(),
    fromWorkStatus: text("from_work_status"),
    toWorkStatus: text("to_work_status").notNull(),
    completedAtSnapshot: timestamptz("completed_at_snapshot"),
    completionNoteSnapshot: text("completion_note_snapshot"),
    reason: text("reason"),
    changedBy: integer("changed_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    changedAt: timestamptz("changed_at").notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "task_status_history_task_fk",
      columns: [table.taskId, table.projectId],
      foreignColumns: [tasks.id, tasks.projectId],
    }).onDelete("restrict"),
    index("task_status_history_task_time_idx").on(
      table.projectId,
      table.taskId,
      table.changedAt,
      table.id,
    ),
    check(
      "task_status_history_from_check",
      sql.raw(
        "from_work_status IS NULL OR from_work_status IN ('TODO', 'DONE', 'CANCELED')",
      ),
    ),
    check(
      "task_status_history_to_check",
      sql.raw("to_work_status IN ('TODO', 'DONE', 'CANCELED')"),
    ),
    check(
      "task_status_history_transition_check",
      sql.raw("from_work_status IS NULL OR from_work_status <> to_work_status"),
    ),
    check(
      "task_status_history_completion_check",
      sql.raw(
        "((from_work_status = 'DONE' OR to_work_status = 'DONE') AND completed_at_snapshot IS NOT NULL) OR ((from_work_status IS DISTINCT FROM 'DONE' AND to_work_status <> 'DONE') AND completed_at_snapshot IS NULL)",
      ),
    ),
    check(
      "task_status_history_note_check",
      sql.raw(
        "completion_note_snapshot IS NULL OR length(btrim(completion_note_snapshot)) BETWEEN 1 AND 10000",
      ),
    ),
    check(
      "task_status_history_reason_check",
      sql.raw("reason IS NULL OR length(btrim(reason)) BETWEEN 1 AND 10000"),
    ),
  ],
);
