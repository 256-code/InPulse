import { Injectable } from "@nestjs/common";

import type { TransactionContext } from "../../database/transaction-context.js";
import {
  TaskManagementError,
  TasksManagementService,
} from "./tasks-management.service.js";
import {
  TaskManagementRepository,
  type TaskScope,
} from "./task-management.repository.js";

export interface ProjectMemberUnfinishedTask {
  readonly taskId: number;
  readonly projectId: number;
  readonly moduleId: number;
  readonly featureId: number | null;
  readonly scopeType: "FEATURE" | "MODULE";
  readonly code: string;
  readonly title: string;
  readonly description: string;
  readonly priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  readonly dueAt: string | null;
  readonly workStatus: "TODO";
  readonly assigneeId: number;
  readonly rowVersion: number;
  readonly impactFeatureIds: number[];
}

export interface ProjectMemberReassignmentInput {
  readonly taskId: number;
  readonly moduleId: number;
  readonly featureId: number | null;
  readonly rowVersion: number;
  readonly assigneeId: number;
}

export class ProjectMemberTaskCommandError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 422,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProjectMemberTaskCommandError";
  }
}

/** 跨 Tasks 域的公开命令边界；成员管理 Workflow 只能调用本 Port，不访问其内部 Repository。 */
@Injectable()
export class ProjectMemberTaskCommandPort {
  constructor(
    private readonly repository: TaskManagementRepository,
    private readonly tasks: TasksManagementService,
  ) {}

  async listUnfinished(
    tx: TransactionContext,
    projectId: number,
    userId: number,
  ): Promise<ProjectMemberUnfinishedTask[]> {
    const rows = (await tx.sql`
      SELECT t.id AS "taskId",
             t.project_id AS "projectId",
             t.module_id AS "moduleId",
             t.feature_id AS "featureId",
             t.scope_type AS "scopeType",
             t.code,
             t.title,
             t.description,
             t.priority,
             t.due_at AS "dueAt",
             t.work_status AS "workStatus",
             t.assignee_id AS "assigneeId",
             t.row_version AS "rowVersion",
             ARRAY(
               SELECT i.feature_id
                 FROM app.task_feature_impacts AS i
                WHERE i.task_id = t.id
                ORDER BY i.feature_id
             ) AS "impactFeatureIds"
        FROM app.tasks AS t
       WHERE t.project_id = ${projectId}
         AND t.assignee_id = ${userId}
         AND t.work_status = 'TODO'
         AND t.lifecycle_status = 'ACTIVE'
       ORDER BY t.id ASC
    `) as unknown as readonly {
      taskId: number;
      projectId: number;
      moduleId: number;
      featureId: number | null;
      scopeType: "FEATURE" | "MODULE";
      code: string;
      title: string;
      description: string;
      priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
      dueAt: Date | null;
      workStatus: "TODO";
      assigneeId: number;
      rowVersion: number;
      impactFeatureIds: number[];
    }[];
    return rows.map((row) => ({
      ...row,
      dueAt: row.dueAt === null ? null : new Date(row.dueAt).toISOString(),
    }));
  }

  async reassign(
    tx: TransactionContext,
    input: {
      readonly actorId: number;
      readonly projectId: number;
      readonly targetUserId: number;
      readonly assignments: readonly ProjectMemberReassignmentInput[];
      readonly requestId: string;
    },
  ): Promise<number[]> {
    const sorted = [...input.assignments].sort((a, b) => a.taskId - b.taskId);
    if (new Set(sorted.map((item) => item.taskId)).size !== sorted.length) {
      throw new ProjectMemberTaskCommandError(
        422,
        "PROJECT_MEMBER_REASSIGNMENT_DUPLICATE",
        "同一个任务不能重复提交改派",
      );
    }
    const reassigned: number[] = [];
    for (const assignment of sorted) {
      const scope: TaskScope = {
        projectId: input.projectId,
        moduleId: assignment.moduleId,
        featureId: assignment.featureId,
      };
      const current = await this.repository.find(tx, scope, assignment.taskId);
      if (current === undefined) {
        throw new ProjectMemberTaskCommandError(
          404,
          "PROJECT_MEMBER_TASK_NOT_FOUND",
          "待改派任务不存在或归属不匹配",
        );
      }
      if (
        current.assigneeId !== input.targetUserId ||
        current.workStatus !== "TODO" ||
        current.lifecycleStatus !== "ACTIVE"
      ) {
        throw new ProjectMemberTaskCommandError(
          409,
          "PROJECT_MEMBER_TASK_NOT_REASSIGNABLE",
          "任务当前负责人或状态已变化，不能随成员移除改派",
        );
      }
      if (current.assigneeId === assignment.assigneeId) {
        throw new ProjectMemberTaskCommandError(
          422,
          "PROJECT_MEMBER_REASSIGNMENT_NOOP",
          "不能把任务改派给当前成员本人",
        );
      }
      try {
        await this.tasks.execute(tx, {
          operation:
            current.featureId === null ? "updateModuleTask" : "updateTask",
          actorId: input.actorId,
          projectId: input.projectId,
          moduleId: current.moduleId,
          featureId: current.featureId,
          taskId: current.id,
          version: assignment.rowVersion,
          edit: {
            title: current.title,
            description: current.description,
            priority: current.priority,
            assigneeId: assignment.assigneeId,
            dueAt: current.dueAt,
          },
          ...(current.featureId === null
            ? { impactFeatureIds: current.impactFeatureIds }
            : {}),
          requestId: input.requestId,
        });
      } catch (error) {
        if (error instanceof TaskManagementError) {
          throw new ProjectMemberTaskCommandError(
            error.status,
            error.code,
            error.message,
          );
        }
        throw error;
      }
      reassigned.push(current.id);
    }
    return reassigned;
  }
}
