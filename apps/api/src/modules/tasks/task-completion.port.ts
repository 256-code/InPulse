import { Inject, Injectable } from "@nestjs/common";
import type {
  TaskCompletionRequest,
  TaskItem,
  ModuleTaskItem,
} from "@inpulse/api-contract";
import type { TransactionContext } from "../../database/transaction-context.js";
import { AuditWritePort } from "../../audit/index.js";
import { ActivityWritePort } from "../activity/index.js";
import { NotificationWritePort } from "../notifications/index.js";
import { SearchProjectionWritePort } from "../search/index.js";
import {
  PROJECT_ACCESS_QUERY_PORT,
  type ProjectAccessQueryPort,
} from "../projects/index.js";
import { TaskManagementRepository } from "./task-management.repository.js";
import { TaskManagementError } from "./tasks-management.service.js";
import type { TaskReadModel } from "./task-query.port.js";
/** Workflow owns authorization and all parent/task/branch locks. This port never opens a transaction. */
export abstract class TaskCompletionCommandPort {
  abstract complete(
    tx: TransactionContext,
    actorId: number,
    source: TaskReadModel,
    input: TaskCompletionRequest,
    recordAuthors: readonly number[],
    requestId: string,
  ): Promise<TaskItem | ModuleTaskItem>;
}
@Injectable()
export class PostgresTaskCompletionCommandPort extends TaskCompletionCommandPort {
  constructor(
    @Inject(TaskManagementRepository)
    private readonly repository: TaskManagementRepository,
    @Inject(AuditWritePort) private readonly audit: AuditWritePort,
    @Inject(ActivityWritePort) private readonly activity: ActivityWritePort,
    @Inject(SearchProjectionWritePort)
    private readonly search: SearchProjectionWritePort,
    @Inject(NotificationWritePort)
    private readonly notifications: NotificationWritePort,
    @Inject(PROJECT_ACCESS_QUERY_PORT)
    private readonly access: ProjectAccessQueryPort,
  ) {
    super();
  }
  async complete(
    tx: TransactionContext,
    actorId: number,
    source: TaskReadModel,
    input: TaskCompletionRequest,
    recordAuthors: readonly number[],
    requestId: string,
  ) {
    const before = await this.repository.find(tx, source, source.taskId);
    if (!before)
      throw new TaskManagementError(
        404,
        "TASK_NOT_FOUND",
        "任务不存在或无法访问",
      );
    if (before.rowVersion !== input.expectedRowVersion)
      throw new TaskManagementError(
        409,
        "TASK_VERSION_CONFLICT",
        "任务版本已变化，请加载最新任务",
      );
    if (before.workStatus !== "TODO" || before.lifecycleStatus !== "ACTIVE")
      throw new TaskManagementError(
        409,
        "TASK_STATE_CONFLICT",
        "任务当前状态不允许完成",
      );
    const note =
      input.mode === "WITHOUT_RECORD"
        ? `${input.completionReason}，不涉及功能变化${input.note ? `：${input.note}` : ""}`
        : null;
    const result = await this.repository.transition(
      tx,
      before,
      actorId,
      "DONE",
      note,
      input.mode === "WITHOUT_RECORD" ? input.completionReason : "发布迭代记录",
    );
    if (!result)
      throw new TaskManagementError(
        409,
        "TASK_VERSION_CONFLICT",
        "任务版本或状态已变化",
      );
    const event = await this.audit.append(tx, {
      projectId: source.projectId,
      actorType: "USER",
      actorId,
      action: "task.status",
      targetType: "TASK",
      targetId: String(source.taskId),
      eventPayload: {
        before,
        after: result,
        mode: input.mode,
        completionNote: note,
      },
      requestId,
    });
    await this.activity.append(tx, {
      projectId: source.projectId,
      sourceChainId: event.chainId,
      sourceSequence: event.sequenceNo,
      sourceEntityType: "TASK",
      sourceEntityId: source.taskId,
      activityType: "task.complete",
      actorId,
      summary: `任务完成：${result.title}`,
      metadata: {
        taskId: result.id,
        moduleId: result.moduleId,
        featureId: result.featureId,
      },
      visibilityScope: "MEMBER",
      sourceStatus: "DONE",
      sourceRowVersion: result.rowVersion,
      occurredAt: new Date(result.updatedAt),
    });
    await this.search.upsert(tx, {
      projectId: source.projectId,
      entityType: "TASK",
      entityId: source.taskId,
      title: result.title,
      summary: result.description.slice(0, 5000),
      rawText: `${result.code}\n${result.title}\n${result.description}`,
      visibilityScope: "MEMBER",
      sourceStatus: "DONE",
      sourceRowVersion: result.rowVersion,
    });
    for (const recipientId of [
      ...new Set([result.creatorId, ...recordAuthors]),
    ].sort((a, b) => a - b)) {
      const check = await this.access.checkProjectForWrite(tx, {
        actorUserId: recipientId,
        projectId: source.projectId,
      });
      if (check.kind !== "allowed") continue;
      await this.notifications.write(tx, {
        projectId: source.projectId,
        recipientId,
        sourceChainId: event.chainId,
        sourceSequence: event.sequenceNo,
        notificationType: "task.complete",
        title: `任务完成：${result.title}`.slice(0, 500),
        body: result.code,
        targetPath: `/projects/${source.projectId}/modules/${source.moduleId}${source.featureId === null ? "/tasks" : `/features/${source.featureId}`}?taskId=${source.taskId}`,
        createdAt: new Date(result.updatedAt),
      });
    }
    return result;
  }
}
