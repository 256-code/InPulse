import { Inject, Injectable } from "@nestjs/common";
import {
  taskReplayContextSchema,
  type TaskItem,
  type TaskEditRequest,
} from "@inpulse/api-contract";
import { AuditWritePort } from "../../audit/index.js";
import type { TransactionContext } from "../../database/transaction-context.js";
import { PostgresUnitOfWork } from "../../database/unit-of-work.js";
import {
  PROJECT_ACCESS_QUERY_PORT,
  type ProjectAccessQueryPort,
  ProjectCodePort,
  ProjectMembersQueryPort,
} from "../projects/index.js";
import { ModuleQueryPort } from "../modules/index.js";
import { FeatureQueryPort, FeatureReadPort } from "../features/index.js";
import { ActivityWritePort } from "../activity/index.js";
import { SearchProjectionWritePort } from "../search/index.js";
import { NotificationWritePort } from "../notifications/index.js";
import {
  TaskManagementRepository,
  type TaskScope,
} from "./task-management.repository.js";

export type TaskOperation = "createTask" | "updateTask";
export class TaskManagementError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 422,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
const missing = () =>
  new TaskManagementError(
    404,
    "TASK_NOT_FOUND",
    "任务或所属功能不存在或无法访问",
  );

@Injectable()
export class TasksManagementService {
  constructor(
    @Inject(PROJECT_ACCESS_QUERY_PORT)
    private readonly access: ProjectAccessQueryPort,
    @Inject(ModuleQueryPort) private readonly modules: ModuleQueryPort,
    @Inject(FeatureQueryPort) private readonly features: FeatureQueryPort,
    @Inject(FeatureReadPort) private readonly featureRead: FeatureReadPort,
    @Inject(ProjectCodePort) private readonly codes: ProjectCodePort,
    @Inject(ProjectMembersQueryPort)
    private readonly members: ProjectMembersQueryPort,
    @Inject(PostgresUnitOfWork) private readonly uow: PostgresUnitOfWork,
    @Inject(TaskManagementRepository)
    private readonly repository: TaskManagementRepository,
    @Inject(AuditWritePort) private readonly audit: AuditWritePort,
    @Inject(ActivityWritePort) private readonly activity: ActivityWritePort,
    @Inject(SearchProjectionWritePort)
    private readonly search: SearchProjectionWritePort,
    @Inject(NotificationWritePort)
    private readonly notifications: NotificationWritePort,
  ) {}
  async read(
    actorId: number,
    scope: TaskScope,
    taskId?: number,
    assignees = false,
  ) {
    const authorized = await this.access.getAuthorizedSearchScope(actorId);
    if (!authorized.projectIds.includes(scope.projectId)) throw missing();
    return this.uow.run(async (tx) => {
      if (
        !(await this.featureRead.find(
          tx,
          scope.projectId,
          scope.moduleId,
          scope.featureId,
        ))
      )
        throw missing();
      if (assignees) {
        const items = await this.members.listActiveMembers(tx, {
          actorUserId: actorId,
          projectId: scope.projectId,
        });
        if (!items) throw missing();
        return { items };
      }
      if (taskId !== undefined) {
        const item = await this.repository.find(tx, scope, taskId);
        if (!item) throw missing();
        return item;
      }
      return { items: await this.repository.list(tx, scope) };
    });
  }
  async authorize(
    tx: TransactionContext,
    actorId: number,
    scope: TaskScope,
    taskId?: number,
  ): Promise<void> {
    const project = await this.access.checkProjectForWrite(tx, {
      actorUserId: actorId,
      projectId: scope.projectId,
    });
    if (project.kind === "not-found") throw missing();
    // Resolve full identity before reporting any archived state.
    if (
      !(await this.featureRead.find(
        tx,
        scope.projectId,
        scope.moduleId,
        scope.featureId,
      ))
    )
      throw missing();
    if (
      taskId !== undefined &&
      !(await this.repository.find(tx, scope, taskId))
    )
      throw missing();
    const module = await this.modules.checkModuleForWrite(tx, scope);
    const feature = await this.features.checkFeatureForWrite(tx, scope);
    if (module.kind === "not-found" || feature.kind === "not-found")
      throw missing();
    if ([project.kind, module.kind, feature.kind].includes("parent-not-active"))
      throw new TaskManagementError(
        409,
        "TASK_PARENT_ARCHIVED",
        "项目、模块或功能已归档，任务只读",
      );
  }
  async replay(
    tx: TransactionContext,
    actorId: number,
    context: unknown,
  ): Promise<void> {
    const resource = taskReplayContextSchema.parse(context);
    await this.authorize(tx, actorId, resource, resource.taskId);
  }
  async execute(
    tx: TransactionContext,
    input: TaskScope & {
      operation: TaskOperation;
      actorId: number;
      taskId?: number;
      version?: number;
      edit: TaskEditRequest;
      requestId: string;
    },
  ): Promise<TaskItem> {
    await this.authorize(tx, input.actorId, input, input.taskId);
    let before: TaskItem | undefined;
    if (input.operation === "updateTask") {
      before = await this.repository.find(tx, input, input.taskId!, true);
      if (!before) throw missing();
      if (before.rowVersion !== input.version)
        throw new TaskManagementError(
          409,
          "TASK_VERSION_CONFLICT",
          "任务版本已变化，请重新加载后编辑",
        );
      if (before.lifecycleStatus !== "ACTIVE")
        throw new TaskManagementError(
          409,
          "TASK_STATE_CONFLICT",
          "任务当前只读",
        );
    }
    const assigned = !before || before.assigneeId !== input.edit.assigneeId;
    if (
      assigned &&
      (await this.members.checkAssignableMember(tx, {
        projectId: input.projectId,
        userId: input.edit.assigneeId,
      })) !== "allowed"
    )
      throw new TaskManagementError(
        422,
        "TASK_ASSIGNEE_INVALID",
        "负责人必须是当前项目的活跃成员",
      );
    const result = before
      ? await this.repository.update(tx, before, input.edit)
      : await this.repository.create(
          tx,
          input,
          input.actorId,
          await this.codes.allocateTaskCode(tx, input.projectId),
          input.edit,
        );
    if (!result)
      throw new TaskManagementError(
        409,
        "TASK_VERSION_CONFLICT",
        "任务版本已变化，请重新加载后编辑",
      );
    const action = before ? "update" : "create";
    const event = await this.audit.append(tx, {
      projectId: result.projectId,
      actorType: "USER",
      actorId: input.actorId,
      action: `task.${action}`,
      targetType: "TASK",
      targetId: String(result.id),
      eventPayload: { before: before ?? null, after: result },
      requestId: input.requestId,
    });
    await this.activity.append(tx, {
      projectId: result.projectId,
      sourceChainId: event.chainId,
      sourceSequence: event.sequenceNo,
      sourceEntityType: "TASK",
      sourceEntityId: result.id,
      activityType: `task.${action}`,
      actorId: input.actorId,
      summary: `任务${before ? "更新" : "创建"}：${result.title}`,
      metadata: {
        taskId: result.id,
        moduleId: result.moduleId,
        featureId: result.featureId,
      },
      visibilityScope: "MEMBER",
      sourceStatus: result.workStatus,
      sourceRowVersion: result.rowVersion,
      occurredAt: new Date(result.updatedAt),
    });
    await this.search.upsert(tx, {
      projectId: result.projectId,
      entityType: "TASK",
      entityId: result.id,
      title: result.title,
      summary: result.description.slice(0, 5000),
      rawText: `${result.code}\n${result.title}\n${result.description}`,
      visibilityScope: "MEMBER",
      sourceStatus: result.workStatus,
      sourceRowVersion: result.rowVersion,
    });
    if (assigned)
      await this.notifications.write(tx, {
        projectId: result.projectId,
        recipientId: result.assigneeId,
        sourceChainId: event.chainId,
        sourceSequence: event.sequenceNo,
        notificationType: "task.assigned",
        title: `任务指派：${result.title}`.slice(0, 500),
        body: result.code,
        targetPath: `/projects/${result.projectId}/modules/${result.moduleId}/features/${result.featureId}?taskId=${result.id}`,
        createdAt: new Date(result.updatedAt),
      });
    return result;
  }
}
