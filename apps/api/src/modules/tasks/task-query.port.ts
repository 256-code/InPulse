import { Injectable } from "@nestjs/common";
import type { TransactionContext } from "../../database/transaction-context.js";

export interface TaskDraftSource {
  taskId: number;
  projectId: number;
  moduleId: number;
  featureId: number | null;
  scopeType: "FEATURE" | "MODULE";
  title: string;
  assigneeId: number;
  workStatus: "TODO" | "DONE" | "CANCELED";
  lifecycleStatus: "ACTIVE" | "ARCHIVED" | "INVALID";
  rowVersion: number;
  impactFeatureIds: number[];
}
/** Caller authorizes the project. lock requires project/module/sorted feature locks first. */
export abstract class TaskQueryPort {
  abstract find(
    tx: TransactionContext,
    projectId: number,
    taskId: number,
  ): Promise<TaskDraftSource | undefined>;
  abstract lock(
    tx: TransactionContext,
    projectId: number,
    taskId: number,
  ): Promise<TaskDraftSource | undefined>;
}
@Injectable()
export class PostgresTaskQueryPort extends TaskQueryPort {
  async find(tx: TransactionContext, projectId: number, taskId: number) {
    const [row] = await tx.sql<
      TaskDraftSource[]
    >`SELECT id AS "taskId",project_id AS "projectId",module_id AS "moduleId",feature_id AS "featureId",scope_type AS "scopeType",title,assignee_id AS "assigneeId",work_status AS "workStatus",lifecycle_status AS "lifecycleStatus",row_version AS "rowVersion",
      ARRAY(SELECT feature_id FROM app.task_feature_impacts WHERE task_id=app.tasks.id ORDER BY feature_id) AS "impactFeatureIds" FROM app.tasks WHERE id=${taskId} AND project_id=${projectId}`;
    return row;
  }
  async lock(tx: TransactionContext, projectId: number, taskId: number) {
    await tx.sql`SELECT id FROM app.tasks WHERE id=${taskId} AND project_id=${projectId} FOR UPDATE`;
    // Separate READ COMMITTED statement sees relationships committed while waiting for the row.
    return this.find(tx, projectId, taskId);
  }
}
