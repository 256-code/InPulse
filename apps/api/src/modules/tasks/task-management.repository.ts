import { Injectable } from "@nestjs/common";
import {
  taskItemSchema,
  moduleTaskItemSchema,
  taskStatusHistoryResponseSchema,
  type ModuleTaskItem,
  type TaskItem,
  type TaskEditRequest,
} from "@inpulse/api-contract";
import type { TransactionContext } from "../../database/transaction-context.js";

export type TaskRecord = TaskItem | ModuleTaskItem;
type Row = Omit<TaskRecord, "createdAt" | "updatedAt" | "dueAt"> & {
  createdAt: Date;
  updatedAt: Date;
  dueAt: Date | null;
  impactFeatureIds: number[];
};
const dto = (row: Row): TaskRecord =>
  (row.featureId === null ? moduleTaskItemSchema : taskItemSchema).parse({
    ...Object.fromEntries(
      Object.entries(row).filter(
        ([key]) => row.featureId === null || key !== "impactFeatureIds",
      ),
    ),
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    dueAt: row.dueAt === null ? null : new Date(row.dueAt).toISOString(),
  });
export interface TaskScope {
  projectId: number;
  moduleId: number;
  featureId: number | null;
}

@Injectable()
export class TaskManagementRepository {
  async history(tx: TransactionContext, scope: TaskScope, taskId: number) {
    const rows = await tx.sql<
      {
        id: string;
        fromWorkStatus: string | null;
        toWorkStatus: string;
        completedAtSnapshot: Date | null;
        completionNoteSnapshot: string | null;
        reason: string | null;
        changedBy: number;
        changedAt: Date;
      }[]
    >`
      SELECT id::text, from_work_status AS "fromWorkStatus", to_work_status AS "toWorkStatus",
        completed_at_snapshot AS "completedAtSnapshot", completion_note_snapshot AS "completionNoteSnapshot",
        reason, changed_by AS "changedBy", changed_at AS "changedAt"
      FROM app.task_status_history WHERE task_id=${taskId} AND project_id=${scope.projectId} ORDER BY app.task_status_history.id`;
    return taskStatusHistoryResponseSchema.parse({
      items: rows.map((row) => ({
        ...row,
        completedAtSnapshot:
          row.completedAtSnapshot === null
            ? null
            : new Date(row.completedAtSnapshot).toISOString(),
        changedAt: new Date(row.changedAt).toISOString(),
      })),
    });
  }
  async transition(
    tx: TransactionContext,
    current: TaskRecord,
    actorId: number,
    to: TaskRecord["workStatus"],
    completionNote: string | null,
    reason: string | null,
  ) {
    // The service has validated the transition under the task lock. Preserve DB timestamp
    // precision in SQL; transaction-start now() can predate a concurrent completed transition.
    const rows = await tx.sql`
      WITH previous AS MATERIALIZED (
        SELECT * FROM app.tasks WHERE id=${current.id} AND project_id=${current.projectId}
      ), stamp AS MATERIALIZED (SELECT GREATEST(clock_timestamp(), updated_at) AS at FROM previous),
      updated AS (
        UPDATE app.tasks SET work_status=${to}, completion_note=${completionNote},
          completed_at=CASE WHEN ${to}='DONE' THEN (SELECT at FROM stamp) ELSE NULL END,
          updated_at=(SELECT at FROM stamp), row_version=row_version+1
        WHERE id=${current.id} AND project_id=${current.projectId} AND row_version=${current.rowVersion}
          AND work_status=${current.workStatus} AND lifecycle_status='ACTIVE'
        RETURNING *
      )
      INSERT INTO app.task_status_history(task_id,project_id,from_work_status,to_work_status,
        completed_at_snapshot,completion_note_snapshot,reason,changed_by,changed_at)
      SELECT u.id,u.project_id,p.work_status,u.work_status,
        CASE WHEN u.work_status='DONE' THEN u.completed_at WHEN p.work_status='DONE' THEN p.completed_at ELSE NULL END,
        CASE WHEN u.work_status='DONE' THEN u.completion_note WHEN p.work_status='DONE' THEN p.completion_note ELSE NULL END,
        ${reason},${actorId},u.updated_at FROM updated u CROSS JOIN previous p RETURNING id`;
    return rows.length ? this.find(tx, current, current.id) : undefined;
  }
  async impacts(tx: TransactionContext, scope: TaskScope, taskId: number) {
    const rows = await tx.sql<
      {
        taskId: number;
        featureId: number;
        moduleId: number;
        projectId: number;
        relationType: string;
        createdAt: Date;
      }[]
    >`SELECT task_id AS "taskId",feature_id AS "featureId",module_id AS "moduleId",project_id AS "projectId",relation_type AS "relationType",created_at AS "createdAt" FROM app.task_feature_impacts WHERE task_id=${taskId} AND project_id=${scope.projectId} AND module_id=${scope.moduleId} ORDER BY feature_id`;
    return rows.map((row) => ({
      ...row,
      createdAt: new Date(row.createdAt).toISOString(),
    }));
  }
  async replaceImpacts(
    tx: TransactionContext,
    task: TaskRecord,
    target: readonly number[],
  ): Promise<void> {
    const previous = await this.impacts(tx, task, task.id);
    for (const relation of previous)
      if (!target.includes(relation.featureId))
        await tx.sql`DELETE FROM app.task_feature_impacts WHERE task_id=${task.id} AND feature_id=${relation.featureId} AND project_id=${task.projectId} AND module_id=${task.moduleId}`;
    for (const featureId of target)
      if (!previous.some((row) => row.featureId === featureId))
        await tx.sql`INSERT INTO app.task_feature_impacts (task_id,feature_id,module_id,project_id) VALUES (${task.id},${featureId},${task.moduleId},${task.projectId})`;
  }
  async list(tx: TransactionContext, scope: TaskScope): Promise<TaskRecord[]> {
    const rows = await tx.sql<
      Row[]
    >`SELECT id, project_id AS "projectId", module_id AS "moduleId", feature_id AS "featureId", scope_type AS "scopeType", code, title, description, assignee_id AS "assigneeId", creator_id AS "creatorId", priority, work_status AS "workStatus", lifecycle_status AS "lifecycleStatus", due_at AS "dueAt", row_version AS "rowVersion", created_at AS "createdAt", updated_at AS "updatedAt", ARRAY(SELECT i.feature_id FROM app.task_feature_impacts i WHERE i.task_id=app.tasks.id ORDER BY i.feature_id) AS "impactFeatureIds" FROM app.tasks WHERE project_id = ${scope.projectId} AND module_id = ${scope.moduleId} AND ${scope.featureId === null ? tx.sql`scope_type = 'MODULE' AND feature_id IS NULL` : tx.sql`((feature_id = ${scope.featureId} AND scope_type = 'FEATURE') OR (scope_type = 'MODULE' AND EXISTS (SELECT 1 FROM app.task_feature_impacts i WHERE i.task_id = app.tasks.id AND i.feature_id = ${scope.featureId})))`} ORDER BY id`;
    return rows.map(dto);
  }
  async find(
    tx: TransactionContext,
    scope: TaskScope,
    taskId: number,
    lock = false,
  ): Promise<TaskRecord | undefined> {
    const [row] = await tx.sql<
      Row[]
    >`SELECT id, project_id AS "projectId", module_id AS "moduleId", feature_id AS "featureId", scope_type AS "scopeType", code, title, description, assignee_id AS "assigneeId", creator_id AS "creatorId", priority, work_status AS "workStatus", lifecycle_status AS "lifecycleStatus", due_at AS "dueAt", row_version AS "rowVersion", created_at AS "createdAt", updated_at AS "updatedAt", ARRAY(SELECT i.feature_id FROM app.task_feature_impacts i WHERE i.task_id=app.tasks.id ORDER BY i.feature_id) AS "impactFeatureIds" FROM app.tasks WHERE project_id = ${scope.projectId} AND module_id = ${scope.moduleId} AND ${scope.featureId === null ? tx.sql`scope_type = 'MODULE' AND feature_id IS NULL` : tx.sql`scope_type = 'FEATURE' AND feature_id = ${scope.featureId}`} AND id = ${taskId} ${lock ? tx.sql`FOR UPDATE` : tx.sql``}`;
    return row ? dto(row) : undefined;
  }
  async create(
    tx: TransactionContext,
    scope: TaskScope,
    actorId: number,
    code: string,
    edit: TaskEditRequest,
  ): Promise<TaskRecord> {
    const [row] = await tx.sql<
      { id: number }[]
    >`INSERT INTO app.tasks (project_id, module_id, feature_id, scope_type, code, title, description, assignee_id, creator_id, priority, due_at, work_status, lifecycle_status) VALUES (${scope.projectId}, ${scope.moduleId}, ${scope.featureId}, ${scope.featureId === null ? "MODULE" : "FEATURE"}, ${code}, ${edit.title}, ${edit.description}, ${edit.assigneeId}, ${actorId}, ${edit.priority}, ${edit.dueAt}, 'TODO', 'ACTIVE') RETURNING id`;
    await tx.sql`INSERT INTO app.task_status_history (task_id, project_id, from_work_status, to_work_status, changed_by) VALUES (${row!.id}, ${scope.projectId}, NULL, 'TODO', ${actorId})`;
    return (await this.find(tx, scope, row!.id))!;
  }
  async update(
    tx: TransactionContext,
    current: TaskRecord,
    edit: TaskEditRequest,
  ): Promise<TaskRecord | undefined> {
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
