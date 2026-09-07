import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { users } from "./identity.js";
import { appSchema } from "./shared.js";

const timestamptz = (name: string) =>
  timestamp(name, { mode: "date", withTimezone: true });

export const projects = appSchema.table(
  "projects",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    createdBy: integer("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("ACTIVE"),
    rowVersion: integer("row_version").notNull().default(1),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
    archivedAt: timestamptz("archived_at"),
  },
  (table) => [
    unique("projects_code_unique").on(table.code),
    unique("projects_id_unique").on(table.id),
    check("projects_code_check", sql.raw("code ~ '^[A-Z][A-Z0-9_]{1,31}$'")),
    check(
      "projects_name_check",
      sql.raw("length(btrim(name)) BETWEEN 1 AND 200"),
    ),
    check(
      "projects_description_check",
      sql.raw("length(description) <= 20000"),
    ),
    check("projects_status_check", sql.raw("status IN ('ACTIVE', 'ARCHIVED')")),
    check("projects_row_version_check", sql.raw("row_version > 0")),
    check(
      "projects_archive_state_check",
      sql.raw(
        "(status = 'ACTIVE' AND archived_at IS NULL) OR (status = 'ARCHIVED' AND archived_at IS NOT NULL)",
      ),
    ),
  ],
);

export const projectMembers = appSchema.table(
  "project_members",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    projectId: integer("project_id").notNull(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("ACTIVE"),
    joinedAt: timestamptz("joined_at").notNull().defaultNow(),
    removedAt: timestamptz("removed_at"),
  },
  (table) => [
    unique("project_members_id_project_unique").on(table.id, table.projectId),
    foreignKey({
      name: "project_members_project_fk",
      columns: [table.projectId],
      foreignColumns: [projects.id],
    }).onDelete("restrict"),
    uniqueIndex("project_members_active_unique")
      .on(table.projectId, table.userId)
      .where(sql.raw("status = 'ACTIVE'")),
    index("project_members_user_active_idx")
      .on(table.userId, table.projectId)
      .where(sql.raw("status = 'ACTIVE'")),
    check(
      "project_members_status_check",
      sql.raw("status IN ('ACTIVE', 'REMOVED')"),
    ),
    check(
      "project_members_state_check",
      sql.raw(
        "(status = 'ACTIVE' AND removed_at IS NULL) OR (status = 'REMOVED' AND removed_at IS NOT NULL AND removed_at >= joined_at)",
      ),
    ),
  ],
);
