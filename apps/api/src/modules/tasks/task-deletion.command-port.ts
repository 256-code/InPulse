import { Inject, Injectable } from "@nestjs/common";
import type { TransactionContext } from "../../database/transaction-context.js";
import {
  TaskManagementRepository,
  type TaskDeletionRow,
  type TaskRecord,
  type TaskScope,
} from "./task-management.repository.js";
import { TasksManagementService } from "./tasks-management.service.js";

/**
 * ADR-058：删除任务在本域需要暴露的边界。跨域编排由 `TaskDeletionWorkflow`
 * 承担，本 Port 只提供任务行的写前门禁、读取与软删除。
 */
export abstract class TaskDeletionCommandPort {
  /** `taskId` 只在执行侧传入；幂等重放时任务已删除，只复核项目可写与父级归属。 */
  abstract authorize(
    tx: TransactionContext,
    actorId: number,
    scope: TaskScope,
    taskId?: number,
  ): Promise<void>;
  abstract find(
    tx: TransactionContext,
    scope: TaskScope,
    taskId: number,
  ): Promise<TaskRecord | undefined>;
  abstract softDelete(
    tx: TransactionContext,
    current: TaskRecord,
    expectedRowVersion: number,
    actorId: number,
  ): Promise<TaskDeletionRow | undefined>;
}

@Injectable()
export class SqlTaskDeletionCommandPort extends TaskDeletionCommandPort {
  constructor(
    @Inject(TasksManagementService)
    private readonly tasks: TasksManagementService,
    @Inject(TaskManagementRepository)
    private readonly repository: TaskManagementRepository,
  ) {
    super();
  }

  authorize(
    tx: TransactionContext,
    actorId: number,
    scope: TaskScope,
    taskId: number,
  ): Promise<void> {
    return this.tasks.authorize(tx, actorId, scope, taskId);
  }

  find(
    tx: TransactionContext,
    scope: TaskScope,
    taskId: number,
  ): Promise<TaskRecord | undefined> {
    return this.repository.find(tx, scope, taskId);
  }

  softDelete(
    tx: TransactionContext,
    current: TaskRecord,
    expectedRowVersion: number,
    actorId: number,
  ): Promise<TaskDeletionRow | undefined> {
    return this.repository.softDelete(tx, current, expectedRowVersion, actorId);
  }
}
