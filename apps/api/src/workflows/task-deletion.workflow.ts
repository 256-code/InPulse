import { Inject, Injectable } from "@nestjs/common";
import { AuditWritePort } from "../audit/index.js";
import type { TransactionContext } from "../database/transaction-context.js";
import { PostgresUnitOfWork } from "../database/unit-of-work.js";
import { ActivityWritePort } from "../modules/activity/index.js";
import { TaskRecordVoidPort } from "../modules/change-records/task-record-void.port.js";
import { ExternalLinksCommandPort } from "../modules/external-links/external-links.port.js";
import { SearchProjectionWritePort } from "../modules/search/index.js";
import { TaskGroupDeletionPort } from "../modules/task-groups/task-group-deletion.port.js";
import { TaskDeletionCommandPort } from "../modules/tasks/task-deletion.command-port.js";
import type { TaskScope } from "../modules/tasks/task-management.repository.js";
import { TaskManagementError } from "../modules/tasks/tasks-management.service.js";

const missing = () =>
  new TaskManagementError(
    404,
    "TASK_NOT_FOUND",
    "任务或所属功能不存在或无法访问",
  );
const conflict = () =>
  new TaskManagementError(
    409,
    "TASK_STATE_CONFLICT",
    "任务已被并发修改，请刷新后重试",
  );
const mainLocked = (groupId: number) =>
  new TaskManagementError(
    409,
    "TASK_GROUP_MAIN_LOCKED",
    `该任务是聚合组 ${groupId} 的主任务，请先解除合并后再删除`,
  );

/** ADR-058：删除任务的响应，字段与 DeleteTaskRequest 的响应契约一一对应。 */
export interface TaskDeletionResult {
  readonly id: number;
  readonly projectId: number;
  readonly moduleId: number;
  readonly featureId: number | null;
  readonly code: string;
  readonly title: string;
  readonly workStatus: "TODO" | "DONE" | "CANCELED";
  readonly deletedAt: string;
  readonly deletedBy: number;
  readonly voidedRecordCount: number;
  readonly removedLinkCount: number;
  readonly detachedGroupRole: "MAIN" | "SOURCE" | null;
}

const DEFAULT_REASON = "任务已被删除";

/** ADR-059：级联删除时逐条复用单任务删除入口所需的输入。 */
export interface TaskDeletionInTransactionInput {
  readonly projectId: number;
  readonly taskId: number;
  /** 调用方已持有任务行锁时为该任务的当前版本。 */
  readonly rowVersion: number;
  readonly actorId: number;
  readonly reason: string;
  readonly requestId: string;
}

/**
 * ADR-058：删除任务。同一事务内解除外部链接关联、作废该任务全部已发布记录、
 * 解除聚合组来源关系，并保留审计与项目动态；任务行以软删除落地（ADR-049 同范式），
 * 不提供还原入口，因此不存在与删除配对的恢复命令。
 */
@Injectable()
export class TaskDeletionWorkflow {
  constructor(
    @Inject(PostgresUnitOfWork) private readonly uow: PostgresUnitOfWork,
    @Inject(TaskDeletionCommandPort)
    private readonly commands: TaskDeletionCommandPort,
    @Inject(AuditWritePort) private readonly audit: AuditWritePort,
    @Inject(ActivityWritePort) private readonly activity: ActivityWritePort,
    @Inject(SearchProjectionWritePort)
    private readonly search: SearchProjectionWritePort,
    @Inject(ExternalLinksCommandPort)
    private readonly links: ExternalLinksCommandPort,
    @Inject(TaskRecordVoidPort) private readonly records: TaskRecordVoidPort,
    @Inject(TaskGroupDeletionPort)
    private readonly groups: TaskGroupDeletionPort,
  ) {}

  async delete(
    actorId: number,
    scope: TaskScope,
    taskId: number,
    expectedRowVersion: number,
    reason: string | null,
    requestId: string,
  ): Promise<TaskDeletionResult> {
    const deletionReason = reason?.trim() ? reason.trim() : DEFAULT_REASON;
    return this.uow.run(async (tx) => {
      // 父级与归属门禁：与其它任务写命令同一口径（项目可写、模块/功能存在）。
      await this.commands.authorize(tx, actorId, scope, taskId);
      const current = await this.commands.find(tx, scope, taskId);
      if (!current) throw missing();
      return this.deleteWithinTransaction(tx, {
        projectId: scope.projectId,
        taskId,
        rowVersion: expectedRowVersion,
        actorId,
        reason: deletionReason,
        requestId,
      });
    });
  }

  /**
   * ADR-059：在同一事务内删除单个任务的共享入口。调用方必须已经完成授权与归属
   * 复核，并传入任务行的当前版本（级联路径已按 ID 升序 `FOR UPDATE` 取锁）。
   * 模块与功能的级联删除复用本方法，因此两条入口的副作用链完全一致。
   */
  async deleteWithinTransaction(
    tx: TransactionContext,
    input: TaskDeletionInTransactionInput,
  ): Promise<TaskDeletionResult> {
    const { projectId, taskId, actorId, reason, requestId } = input;
    // 软删除先执行：条件 UPDATE 会持有任务行锁，后续聚合组写入才满足
    // 「先持任务锁再改成员关系」的前提；任一后续步骤失败则整体回滚。
    const deleted = await this.commands.softDelete(
      tx,
      { id: taskId, projectId },
      input.rowVersion,
      actorId,
    );
    if (!deleted) throw conflict();
    const removedLinkCount = await this.links.detachTarget(
      tx,
      projectId,
      "TASK",
      taskId,
    );
    // 聚合组：来源关系解除，主任务要求调用方先解除合并。
    const group = await this.groups.prepareTaskDeletion(tx, {
      projectId,
      taskId,
      actorId,
      reason,
    });
    if (group.kind === "blocked")
      throw group.reason === "main" ? mainLocked(group.groupId) : conflict();
    const voided = await this.records.voidTaskRecords(tx, {
      projectId,
      taskId,
      actorId,
      requestId,
      reason,
    });
    const detachedGroupId = group.kind === "detached" ? group.groupId : null;
    const event = await this.audit.append(tx, {
      projectId,
      actorType: "USER",
      actorId,
      action: "task.delete",
      targetType: "TASK",
      targetId: String(taskId),
      eventPayload: {
        taskId,
        code: deleted.code,
        title: deleted.title,
        moduleId: deleted.moduleId,
        featureId: deleted.featureId,
        workStatus: deleted.workStatus,
        reason,
        voidedRecords: voided.map((entry) => entry.recordId),
        removedLinkCount,
        detachedGroupId,
      },
      requestId,
    });
    // 删除对项目成员可见：项目动态保留「谁删了哪条任务」，审计链只追加。
    const visibility = {
      projectId,
      sourceEntityType: "TASK" as const,
      sourceEntityId: taskId,
      visibilityScope: "MEMBER" as const,
      // 删除后任务不再有行版本语义，用删除产生的版本号保持投影单调。
      sourceStatus: "DELETED",
      sourceRowVersion: input.rowVersion + 1,
    };
    await this.activity.updateEntityVisibility(tx, visibility);
    await this.activity.append(tx, {
      ...visibility,
      sourceChainId: event.chainId,
      sourceSequence: event.sequenceNo,
      activityType: "TASK_DELETED",
      actorId,
      summary: `删除任务：${deleted.title}`,
      metadata: {
        taskId,
        code: deleted.code,
        moduleId: deleted.moduleId,
        featureId: deleted.featureId,
        workStatus: deleted.workStatus,
        voidedRecordIds: voided.map((entry) => entry.recordId),
        removedLinkCount,
        detachedGroupId,
      },
      occurredAt: new Date(deleted.deletedAt),
    });
    await this.search.remove(tx, projectId, "TASK", taskId);
    return {
      id: deleted.id,
      projectId: deleted.projectId,
      moduleId: deleted.moduleId,
      featureId: deleted.featureId,
      code: deleted.code,
      title: deleted.title,
      workStatus: deleted.workStatus,
      deletedAt: new Date(deleted.deletedAt).toISOString(),
      deletedBy: actorId,
      voidedRecordCount: voided.length,
      removedLinkCount,
      detachedGroupRole: detachedGroupId === null ? null : "SOURCE",
    };
  }
}
