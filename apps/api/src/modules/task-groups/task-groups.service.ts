import { Inject, Injectable } from "@nestjs/common";
import {
  taskGroupMergeReplayContextSchema,
  type TaskGroupItem,
  type TaskGroupMergeRequest,
} from "@inpulse/api-contract";

import { AuditWritePort } from "../../audit/index.js";
import type { TransactionContext } from "../../database/transaction-context.js";
import { ActivityWritePort } from "../activity/index.js";
import { NotificationWritePort } from "../notifications/index.js";
import { SearchProjectionWritePort } from "../search/index.js";
import {
  PROJECT_ACCESS_QUERY_PORT,
  ProjectCodePort,
  type ProjectAccessQueryPort,
} from "../projects/index.js";
import { ModuleQueryPort } from "../modules/index.js";
import { FeatureQueryPort } from "../features/index.js";
import { TaskQueryPort, type TaskReadModel } from "../tasks/index.js";
import {
  TaskGroupRepository,
  type TaskGroupMemberRecord,
  type TaskGroupRecord,
} from "./task-group.repository.js";

/** 合并事务内最大尝试次数；超过即终止，避免长事务内忙等（技术设计 6.4）。 */
const MERGE_LOCK_ATTEMPTS = 3;
const MERGE_ACTIVITY_TYPE = "task.merge";
const MERGE_NOTIFICATION_TYPE = "task.merge";

export class TaskGroupMergeError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 422,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "TaskGroupMergeError";
  }
}

const missing = () =>
  new TaskGroupMergeError(404, "TASK_MERGE_NOT_FOUND", "任务不存在或无法访问");
const parentArchived = (message: string) =>
  new TaskGroupMergeError(409, "TASK_MERGE_PARENT_ARCHIVED", message);
const alreadyMerged = (message: string) =>
  new TaskGroupMergeError(409, "TASK_ALREADY_MERGED", message);
const groupStateConflict = (message: string) =>
  new TaskGroupMergeError(409, "TASK_GROUP_STATE_CONFLICT", message);

interface TaskPair {
  readonly source: TaskReadModel;
  readonly main: TaskReadModel;
}

/**
 * F-23 任务合并（技术设计 6.4）。
 *
 * 锁序固定为项目 FOR SHARE -> 模块 FOR SHARE -> 影响功能 FOR SHARE ->
 * source/main 任务 ID 升序 FOR UPDATE -> 已有聚合组 FOR UPDATE；获得任务锁后
 * 重新读取并比对预读结果，变化时回滚到保存点从头有限重试。
 * 合并只建立关系与来源快照，不修改任何任务字段。
 */
@Injectable()
export class TaskGroupsService {
  constructor(
    @Inject(PROJECT_ACCESS_QUERY_PORT)
    private readonly access: ProjectAccessQueryPort,
    @Inject(ProjectCodePort) private readonly codes: ProjectCodePort,
    @Inject(ModuleQueryPort) private readonly modules: ModuleQueryPort,
    @Inject(FeatureQueryPort) private readonly features: FeatureQueryPort,
    @Inject(TaskQueryPort) private readonly tasks: TaskQueryPort,
    @Inject(TaskGroupRepository) private readonly groups: TaskGroupRepository,
    @Inject(AuditWritePort) private readonly audit: AuditWritePort,
    @Inject(ActivityWritePort) private readonly activity: ActivityWritePort,
    @Inject(NotificationWritePort)
    private readonly notifications: NotificationWritePort,
    @Inject(SearchProjectionWritePort)
    private readonly search: SearchProjectionWritePort,
  ) {}

  /** 写前授权：实时成员关系与项目 ACTIVE；返回 404/409 已映射错误。 */
  private async authorizeProject(
    tx: TransactionContext,
    actorId: number,
    projectId: number,
  ): Promise<void> {
    const project = await this.access.checkProjectForWrite(tx, {
      actorUserId: actorId,
      projectId,
    });
    if (project.kind === "not-found") throw missing();
    if (project.kind === "parent-not-active")
      throw parentArchived("项目已归档，不能合并任务");
  }

  /** 父级锁：模块按 ID 升序、影响功能按所属模块分组后按 ID 升序取 FOR SHARE。 */
  private async lockParents(
    tx: TransactionContext,
    projectId: number,
    tasks: readonly TaskReadModel[],
  ): Promise<void> {
    const moduleIds = [...new Set(tasks.map((task) => task.moduleId))].sort(
      (a, b) => a - b,
    );
    for (const moduleId of moduleIds) {
      const module = await this.modules.checkModuleForWrite(tx, {
        projectId,
        moduleId,
      });
      if (module.kind === "not-found") throw missing();
      if (module.kind === "parent-not-active")
        throw parentArchived("所属模块已归档，不能合并任务");
    }
    for (const task of tasks) {
      const featureIds = [
        ...new Set([
          ...(task.featureId === null ? [] : [task.featureId]),
          ...task.impactFeatureIds,
        ]),
      ].sort((a, b) => a - b);
      for (const featureId of featureIds) {
        const feature = await this.features.checkFeatureForWrite(tx, {
          projectId,
          moduleId: task.moduleId,
          featureId,
        });
        if (feature.kind === "not-found") throw missing();
        if (feature.kind === "parent-not-active")
          throw parentArchived("所属功能已归档，不能合并任务");
      }
    }
  }

  private async readPair(
    tx: TransactionContext,
    projectId: number,
    sourceTaskId: number,
    mainTaskId: number,
  ): Promise<TaskPair | undefined> {
    const source = await this.tasks.find(tx, projectId, sourceTaskId);
    const main = await this.tasks.find(tx, projectId, mainTaskId);
    return source && main ? { source, main } : undefined;
  }

  /** 任务锁：source/main 按 ID 升序 FOR UPDATE，锁后各自重读。 */
  private async lockPair(
    tx: TransactionContext,
    projectId: number,
    sourceTaskId: number,
    mainTaskId: number,
  ): Promise<TaskPair | undefined> {
    const locked = new Map<number, TaskReadModel>();
    for (const taskId of [sourceTaskId, mainTaskId].sort((a, b) => a - b)) {
      const row = await this.tasks.lock(tx, projectId, taskId);
      if (row) locked.set(taskId, row);
    }
    const source = locked.get(sourceTaskId);
    const main = locked.get(mainTaskId);
    return source && main ? { source, main } : undefined;
  }

  /**
   * 合并命令：幂等事务内完成关系写入、审计、活动、通知与搜索投影。
   * 调用方（HTTP 层）已校验 Session/CSRF 并持有同一 `TransactionContext`。
   */
  async execute(
    tx: TransactionContext,
    actorId: number,
    input: TaskGroupMergeRequest,
    requestId: string,
  ): Promise<TaskGroupItem> {
    if (input.sourceTaskId === input.mainTaskId)
      throw new TaskGroupMergeError(
        422,
        "TASK_MERGE_SELF_REFERENCE",
        "不能把任务合并到自己",
      );
    const sourcePre = await this.tasks.findByTaskId(tx, input.sourceTaskId);
    const mainPre = await this.tasks.findByTaskId(tx, input.mainTaskId);
    if (!sourcePre || !mainPre) throw missing();
    // 跨项目合并按不存在处理，避免泄露其他项目任务的存在性。
    if (sourcePre.projectId !== mainPre.projectId) throw missing();
    const projectId = sourcePre.projectId;
    await this.authorizeProject(tx, actorId, projectId);

    for (let attempt = 0; attempt < MERGE_LOCK_ATTEMPTS; attempt++) {
      await tx.sql`SAVEPOINT task_merge_attempt`;
      const previous = await this.readPair(
        tx,
        projectId,
        input.sourceTaskId,
        input.mainTaskId,
      );
      if (!previous) throw missing();
      await this.lockParents(tx, projectId, [previous.source, previous.main]);
      const locked = await this.lockPair(
        tx,
        projectId,
        input.sourceTaskId,
        input.mainTaskId,
      );
      if (!locked) throw missing();
      if (JSON.stringify(locked) !== JSON.stringify(previous)) {
        await tx.sql`ROLLBACK TO SAVEPOINT task_merge_attempt`;
        await tx.sql`RELEASE SAVEPOINT task_merge_attempt`;
        continue;
      }
      const item = await this.mergeLockedPair(
        tx,
        actorId,
        projectId,
        locked,
        input,
        requestId,
      );
      await tx.sql`RELEASE SAVEPOINT task_merge_attempt`;
      return item;
    }
    throw groupStateConflict("任务正在被其他操作修改，请重新加载后再合并");
  }

  /** 已持有项目/模块/功能/任务锁后的合并写入；结果与来源快照同事务提交。 */
  private async mergeLockedPair(
    tx: TransactionContext,
    actorId: number,
    projectId: number,
    pair: TaskPair,
    input: TaskGroupMergeRequest,
    requestId: string,
  ): Promise<TaskGroupItem> {
    const { source, main } = pair;
    if (
      source.lifecycleStatus !== "ACTIVE" ||
      main.lifecycleStatus !== "ACTIVE"
    )
      throw parentArchived("任务已归档或无效，不能合并");
    const sourceActive = await this.groups.findActiveMember(
      tx,
      projectId,
      source.taskId,
    );
    if (sourceActive)
      throw alreadyMerged("来源任务已属于聚合组，请先解除原关系");

    const mainActive = await this.groups.findActiveMember(
      tx,
      projectId,
      main.taskId,
    );
    let group: TaskGroupRecord;
    let joinedExistingGroup = false;
    let before: Readonly<Record<string, unknown>> | null = null;
    if (mainActive === undefined) {
      const code = await this.codes.allocateTaskGroupCode(tx, projectId);
      group = await this.groups.createGroup(tx, {
        projectId,
        code,
        name: main.title.slice(0, 500),
        createdBy: actorId,
      });
      await this.groups.createMember(tx, {
        groupId: group.groupId,
        taskId: main.taskId,
        projectId,
        role: "MAIN",
        sourceKind: null,
        originalWorkStatus: null,
        originalAssigneeId: null,
      });
    } else {
      if (mainActive.role !== "MAIN")
        throw groupStateConflict(
          "主任务在该聚合组中不是主任务，请解除原关系后再合并",
        );
      const lockedGroup = await this.groups.lockGroup(
        tx,
        projectId,
        mainActive.groupId,
      );
      if (!lockedGroup) throw missing();
      if (lockedGroup.status !== "ACTIVE")
        throw groupStateConflict("聚合组已关闭，不能新增来源任务");
      const members = await this.groups.listMembers(
        tx,
        projectId,
        lockedGroup.groupId,
      );
      const activeMain = members.find(
        (member) => member.role === "MAIN" && member.status === "ACTIVE",
      );
      if (activeMain === undefined || activeMain.taskId !== main.taskId)
        throw groupStateConflict("聚合组主任务已变化，请重新加载后再合并");
      // 唯一约束禁止同组第二条历史成员，锁内提前给出稳定的业务错误。
      if (members.some((member) => member.taskId === source.taskId))
        throw alreadyMerged("来源任务与该聚合组已有历史关系，不能重复合并");
      before = {
        groupId: lockedGroup.groupId,
        rowVersion: lockedGroup.rowVersion,
        memberCount: members.length,
      };
      group = lockedGroup;
      joinedExistingGroup = true;
    }

    const sourceMember: TaskGroupMemberRecord = await this.groups.createMember(
      tx,
      {
        groupId: group.groupId,
        taskId: source.taskId,
        projectId,
        role: "SOURCE",
        sourceKind: input.sourceKind,
        originalWorkStatus: source.workStatus,
        originalAssigneeId: source.assigneeId,
      },
    );
    if (joinedExistingGroup) {
      const touched = await this.groups.touchGroup(
        tx,
        projectId,
        group.groupId,
        group.rowVersion,
      );
      if (!touched)
        throw groupStateConflict("聚合组已变化，请重新加载后再合并");
      const refreshed = await this.groups.findGroup(
        tx,
        projectId,
        group.groupId,
      );
      if (!refreshed) throw missing();
      group = refreshed;
    }

    const occurredAt = new Date();
    const event = await this.audit.append(tx, {
      projectId,
      actorType: "USER",
      actorId,
      action: MERGE_ACTIVITY_TYPE,
      targetType: "TASK_GROUP",
      targetId: String(group.groupId),
      eventPayload: {
        before,
        after: {
          groupId: group.groupId,
          code: group.code,
          name: group.name,
          status: group.status,
          rowVersion: group.rowVersion,
          created: !joinedExistingGroup,
          mainTaskId: main.taskId,
          sourceTaskId: source.taskId,
          sourceMemberId: sourceMember.memberId,
          sourceKind: input.sourceKind,
        },
        source: {
          taskId: source.taskId,
          code: source.code,
          moduleId: source.moduleId,
          featureId: source.featureId,
          workStatus: source.workStatus,
          assigneeId: source.assigneeId,
          lifecycleStatus: source.lifecycleStatus,
        },
        main: {
          taskId: main.taskId,
          code: main.code,
          moduleId: main.moduleId,
          featureId: main.featureId,
          workStatus: main.workStatus,
          assigneeId: main.assigneeId,
          lifecycleStatus: main.lifecycleStatus,
        },
        mergeNote: input.mergeNote,
      },
      requestId,
      occurredAt,
    });
    await this.activity.append(tx, {
      projectId,
      sourceChainId: event.chainId,
      sourceSequence: event.sequenceNo,
      sourceEntityType: "TASK_GROUP",
      sourceEntityId: group.groupId,
      activityType: MERGE_ACTIVITY_TYPE,
      actorId,
      summary:
        `合并任务：${source.code} ${source.title} 并入 ${main.code} ${main.title}`.slice(
          0,
          1000,
        ),
      metadata: {
        groupId: group.groupId,
        code: group.code,
        mainTaskId: main.taskId,
        sourceTaskId: source.taskId,
        sourceKind: input.sourceKind,
      },
      visibilityScope: "MEMBER",
      sourceStatus: group.status,
      sourceRowVersion: group.rowVersion,
      occurredAt,
    });
    const targetPath =
      main.featureId === null
        ? `/projects/${projectId}/modules/${main.moduleId}/tasks?taskId=${main.taskId}`
        : `/projects/${projectId}/modules/${main.moduleId}/features/${main.featureId}?taskId=${main.taskId}`;
    const recipients = [
      ...new Set([
        main.assigneeId,
        source.assigneeId,
        main.creatorId,
        source.creatorId,
      ]),
    ].sort((a, b) => a - b);
    const notificationBody =
      input.mergeNote === null
        ? `${source.code} -> ${main.code}`
        : input.mergeNote.slice(0, 5000);
    for (const recipientId of recipients)
      await this.notifications.write(tx, {
        recipientId,
        projectId,
        sourceChainId: event.chainId,
        sourceSequence: event.sequenceNo,
        notificationType: MERGE_NOTIFICATION_TYPE,
        title: `任务合并：${source.title} 并入 ${main.title}`.slice(0, 500),
        body: notificationBody,
        targetPath,
        createdAt: occurredAt,
      });
    await this.search.upsert(tx, {
      projectId,
      entityType: "TASK_GROUP",
      entityId: group.groupId,
      title: group.name,
      summary: input.mergeNote ?? "",
      rawText: `${group.code} ${group.name} ${source.code} ${source.title} ${main.code} ${main.title}`,
      visibilityScope: "MEMBER",
      sourceStatus: group.status,
      sourceRowVersion: group.rowVersion,
    });

    const item = await this.groups.findGroupItem(tx, projectId, group.groupId);
    if (!item || item.mainTaskId !== main.taskId) throw missing();
    return item;
  }

  /** 幂等重放前的当前权限复核：项目可写、聚合组可读且仍 ACTIVE、结果任务可读。 */
  async replay(
    tx: TransactionContext,
    actorId: number,
    context: unknown,
  ): Promise<void> {
    const saved = taskGroupMergeReplayContextSchema.safeParse(context);
    if (!saved.success) throw new Error("invalid task group replay context");
    const { projectId, groupId, taskIds } = saved.data;
    await this.authorizeProject(tx, actorId, projectId);
    const group = await this.groups.findGroup(tx, projectId, groupId);
    if (!group || group.status !== "ACTIVE") throw missing();
    for (const taskId of taskIds)
      if (!(await this.tasks.find(tx, projectId, taskId))) throw missing();
  }
}
