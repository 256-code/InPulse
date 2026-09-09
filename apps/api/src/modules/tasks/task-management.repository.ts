import { Injectable } from "@nestjs/common";
import {
  taskItemSchema,
  type TaskItem,
  type TaskEditRequest,
} from "@inpulse/api-contract";
import type { TransactionContext } from "../../database/transaction-context.js";

type Row = Omit<TaskItem, "createdAt" | "updatedAt" | "dueAt"> & {
  createdAt: Date;
  updatedAt: Date;
  dueAt: Date | null;
};
const dto = (row: Row): TaskItem =>
  taskItemSchema.parse({
    ...row,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    dueAt: row.dueAt === null ? null : new Date(row.dueAt).toISOString(),
  });
export interface TaskScope {
  projectId: number;
  moduleId: number;
  featureId: number;
}

@Injectable()
export class TaskManagementRepository {
  async list(tx: TransactionContext, scope: TaskScope): Promise<TaskItem[]> {
    const rows = await tx.sql<
      Row[]
    >`SELECT id, project_id AS "projectId", module_id AS "moduleId", feature_id AS "featureId", scope_type AS "scopeType", code, title, description, assignee_id AS "assigneeId", creator_id AS "creatorId", priority, work_status AS "workStatus", lifecycle_status AS "lifecycleStatus", due_at AS "dueAt", row_version AS "rowVersion", created_at AS "createdAt", updated_at AS "updatedAt" FROM app.tasks WHERE project_id = ${scope.projectId} AND module_id = ${scope.moduleId} AND feature_id = ${scope.featureId} AND scope_type = 'FEATURE' ORDER BY id`;
    return rows.map(dto);
  }
  async find(
    tx: TransactionContext,
    scope: TaskScope,
    taskId: number,
    lock = false,
  ): Promise<TaskItem | undefined> {
    const [row] = await tx.sql<
      Row[]
    >`SELECT id, project_id AS "projectId", module_id AS "moduleId", feature_id AS "featureId", scope_type AS "scopeType", code, title, description, assignee_id AS "assigneeId", creator_id AS "creatorId", priority, work_status AS "workStatus", lifecycle_status AS "lifecycleStatus", due_at AS "dueAt", row_version AS "rowVersion", created_at AS "createdAt", updated_at AS "updatedAt" FROM app.tasks WHERE project_id = ${scope.projectId} AND module_id = ${scope.moduleId} AND feature_id = ${scope.featureId} AND scope_type = 'FEATURE' AND id = ${taskId} ${lock ? tx.sql`FOR UPDATE` : tx.sql``}`;
    return row ? dto(row) : undefined;
  }
  async create(
    tx: TransactionContext,
    scope: TaskScope,
    actorId: number,
    code: string,
    edit: TaskEditRequest,
  ): Promise<TaskItem> {
    const [row] = await tx.sql<
      { id: number }[]
    >`INSERT INTO app.tasks (project_id, module_id, feature_id, scope_type, code, title, description, assignee_id, creator_id, priority, due_at, work_status, lifecycle_status) VALUES (${scope.projectId}, ${scope.moduleId}, ${scope.featureId}, 'FEATURE', ${code}, ${edit.title}, ${edit.description}, ${edit.assigneeId}, ${actorId}, ${edit.priority}, ${edit.dueAt}, 'TODO', 'ACTIVE') RETURNING id`;
    await tx.sql`INSERT INTO app.task_status_history (task_id, project_id, from_work_status, to_work_status, changed_by) VALUES (${row!.id}, ${scope.projectId}, NULL, 'TODO', ${actorId})`;
    return (await this.find(tx, scope, row!.id))!;
  }
  async update(
    tx: TransactionContext,
    current: TaskItem,
    edit: TaskEditRequest,
  ): Promise<TaskItem | undefined> {
    // Omit assignee_id entirely when unchanged: historical removed members may be retained.
    const assignee =
      current.assigneeId === edit.assigneeId
        ? tx.sql``
        : tx.sql`, assignee_id = ${edit.assigneeId}`;
    const rows =
      await tx.sql`UPDATE app.tasks SET title = ${edit.title}, description = ${edit.description}, priority = ${edit.priority}, due_at = ${edit.dueAt}, row_version = row_version + 1, updated_at = now() ${assignee} WHERE id = ${current.id} AND project_id = ${current.projectId} AND row_version = ${current.rowVersion} RETURNING id`;
    return rows.length ? this.find(tx, current, current.id) : undefined;
  }
}
