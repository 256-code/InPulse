import { Injectable } from "@nestjs/common";
import type { TransactionContext } from "../../database/transaction-context.js";

/** 任务身份、归属、状态与影响功能的稳定读模型。 */
export interface TaskReadModel {
  taskId: number;
  projectId: number;
  moduleId: number;
  featureId: number | null;
  scopeType: "FEATURE" | "MODULE";
  code: string;
  title: string;
  creatorId: number;
  assigneeId: number;
  workStatus: "TODO" | "DONE" | "CANCELED";
  lifecycleStatus: "ACTIVE" | "ARCHIVED" | "INVALID";
  rowVersion: number;
  impactFeatureIds: number[];
}
/** Caller authorizes the project. lock requires project/module/sorted feature locks first. */
export abstract class TaskQueryPort {
  /**
   * 项目无关的预读，供请求只携带任务 ID、需要先解析真实归属的命令使用。
   * 预读结果不得用于写决策：取得父级与任务锁后必须重新读取；
   * 跨项目或不可访问的统一按不存在处理。
   */
  abstract findByTaskId(
    tx: TransactionContext,
    taskId: number,
  ): Promise<TaskReadModel | undefined>;
  abstract find(
    tx: TransactionContext,
    projectId: number,
    taskId: number,
  ): Promise<TaskReadModel | undefined>;
  abstract lock(
    tx: TransactionContext,
    projectId: number,
    taskId: number,
  ): Promise<TaskReadModel | undefined>;
}
@Injectable()
export class PostgresTaskQueryPort extends TaskQueryPort {
  async findByTaskId(tx: TransactionContext, taskId: number) {
    const [row] = await tx.sql<
      TaskReadModel[]
    >`SELECT id AS "taskId",project_id AS "projectId",module_id AS "moduleId",feature_id AS "featureId",scope_type AS "scopeType",code,title,creator_id AS "creatorId",assignee_id AS "assigneeId",work_status AS "workStatus",lifecycle_status AS "lifecycleStatus",row_version AS "rowVersion",
      ARRAY(SELECT feature_id FROM app.task_feature_impacts WHERE task_id=app.tasks.id ORDER BY feature_id) AS "impactFeatureIds" FROM app.tasks WHERE id=${taskId}`;
    return row;
  }
  async find(tx: TransactionContext, projectId: number, taskId: number) {
    const [row] = await tx.sql<
      TaskReadModel[]
    >`SELECT id AS "taskId",project_id AS "projectId",module_id AS "moduleId",feature_id AS "featureId",scope_type AS "scopeType",code,title,creator_id AS "creatorId",assignee_id AS "assigneeId",work_status AS "workStatus",lifecycle_status AS "lifecycleStatus",row_version AS "rowVersion",
      ARRAY(SELECT feature_id FROM app.task_feature_impacts WHERE task_id=app.tasks.id ORDER BY feature_id) AS "impactFeatureIds" FROM app.tasks WHERE id=${taskId} AND project_id=${projectId}`;
    return row;
  }
  async lock(tx: TransactionContext, projectId: number, taskId: number) {
    await tx.sql`SELECT id FROM app.tasks WHERE id=${taskId} AND project_id=${projectId} FOR UPDATE`;
    // Separate READ COMMITTED statement sees relationships committed while waiting for the row.
    return this.find(tx, projectId, taskId);
  }
}
