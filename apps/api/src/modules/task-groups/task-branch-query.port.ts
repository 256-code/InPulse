import { Inject, Injectable } from "@nestjs/common";
import type { TransactionContext } from "../../database/transaction-context.js";
import { TaskGroupRepository } from "./task-group.repository.js";
export interface TaskBranchIdentity {
  groupId: number;
  role: "MAIN" | "SOURCE";
  sourceKind: "ACTIVE" | "HISTORICAL" | null;
}
/** Caller holds task lock before lock(); group membership mutation also requires that task lock. */
export abstract class TaskBranchQueryPort {
  abstract find(
    tx: TransactionContext,
    projectId: number,
    taskId: number,
  ): Promise<TaskBranchIdentity | null>;
  abstract lock(
    tx: TransactionContext,
    projectId: number,
    taskId: number,
  ): Promise<TaskBranchIdentity | null>;
}
@Injectable()
export class PostgresTaskBranchQueryPort extends TaskBranchQueryPort {
  constructor(
    @Inject(TaskGroupRepository)
    private readonly repository: TaskGroupRepository,
  ) {
    super();
  }
  async find(tx: TransactionContext, projectId: number, taskId: number) {
    const member = await this.repository.findActiveMember(
      tx,
      projectId,
      taskId,
    );
    if (!member) return null;
    const group = await this.repository.findGroup(
      tx,
      projectId,
      member.groupId,
    );
    return group?.status === "ACTIVE"
      ? {
          groupId: member.groupId,
          role: member.role,
          sourceKind: member.sourceKind,
        }
      : null;
  }
  async lock(tx: TransactionContext, projectId: number, taskId: number) {
    const before = await this.find(tx, projectId, taskId);
    if (before) await this.repository.lockGroup(tx, projectId, before.groupId);
    return this.find(tx, projectId, taskId);
  }
}
