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
  /**
   * ADR-059：级联删除模块（`featureId = null`）或功能时，按 ID 升序取范围内
   * 全部未删除任务的引用。`lock` 为真时一次性 `FOR UPDATE`，调用方随后逐条
   * 交给 `TaskDeletionWorkflow.deleteWithinTransaction` 删除。
   */
  abstract listForScope(
    tx: TransactionContext,
    projectId: number,
    scope: { readonly moduleId: number; readonly featureId: number | null },
    lock?: boolean,
  ): Promise<{ id: number; rowVersion: number }[]>;
  /**
   * ADR-059：级联前一次性取回范围内仍是活跃聚合组主任务的任务 ID。
   * 逐条删除会先把来源标为解除并可能关闭组，主任务的身份随之消失，
   * 因此 MAIN 门禁必须与逐条删除解耦，否则结果依赖任务 ID 顺序。
   */
  abstract listActiveMainTaskIds(
    tx: TransactionContext,
    projectId: number,
    scope: { readonly moduleId: number; readonly featureId: number | null },
  ): Promise<number[]>;
  /**
   * `current` 只用到 `id` 与 `projectId`：级联删除已按 ID 升序持有行锁，
   * 不必为了删除再读一次整行（ADR-059）。
   */
  abstract softDelete(
    tx: TransactionContext,
    current: Pick<TaskRecord, "id" | "projectId">,
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

  listForScope(
    tx: TransactionContext,
    projectId: number,
    scope: { readonly moduleId: number; readonly featureId: number | null },
    lock = false,
  ): Promise<{ id: number; rowVersion: number }[]> {
    return this.repository.listForDeletionScope(tx, projectId, scope, lock);
  }

  listActiveMainTaskIds(
    tx: TransactionContext,
    projectId: number,
    scope: { readonly moduleId: number; readonly featureId: number | null },
  ): Promise<number[]> {
    return this.repository.listActiveMainTaskIds(tx, projectId, scope);
  }

  softDelete(
    tx: TransactionContext,
    current: Pick<TaskRecord, "id" | "projectId">,
    expectedRowVersion: number,
    actorId: number,
  ): Promise<TaskDeletionRow | undefined> {
    return this.repository.softDelete(tx, current, expectedRowVersion, actorId);
  }
}
