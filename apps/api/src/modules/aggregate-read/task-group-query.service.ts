import { Inject, Injectable } from "@nestjs/common";

import {
  AGGREGATE_READ_PAGE_LIMIT_DEFAULT,
  type TaskGroupDetailResponse,
  type TaskGroupMemberDetail,
  type TaskGroupRecordItem,
  type TaskGroupRecordLink,
  type TaskGroupRecordPage,
  type TaskGroupSummary,
} from "@inpulse/api-contract";

import { UserReadPort, type UserRefItem } from "../../auth/user-read.port.js";
import type { TransactionContext } from "../../database/transaction-context.js";
import {
  PostgresUnitOfWork,
  type UnitOfWork,
} from "../../database/unit-of-work.js";
import {
  ChangeRecordReadPort,
  type TaskPublishedRecordCountItem,
} from "../change-records/index.js";
import {
  ExternalLinksQueryPort,
  type ChangeRecordLinkRow,
} from "../external-links/index.js";
import {
  PROJECT_ACCESS_QUERY_PORT,
  type ProjectAccessQueryPort,
} from "../projects/index.js";
import {
  TaskGroupReadPort,
  type TaskGroupMemberRow,
  type TaskGroupReadRecord,
} from "../task-groups/index.js";
import { TaskQueryPort, type TaskReadModel } from "../tasks/index.js";
import {
  AggregateReadCursorError,
  AggregateReadCursorService,
} from "./aggregate-read-cursor.js";
import {
  AggregateReadError,
  invalidCursorError,
} from "./aggregate-read.errors.js";

/**
 * R-1 任务聚合组视图与 R-4 聚合组记录列表的聚合读服务。
 *
 * 授权：只调用 A 的 ProjectAccessQueryPort 取得服务端 AuthorizedProjectScope；
 * 组不存在、项目不在授权范围（含非成员）统一 404，不返回 403（A 裁决 Q-01）。
 * 事务：一次请求一个只读事务，不创建命令 UnitOfWork、不取任何行锁、不写投影。
 * 归属：记录列表按 Q-02 形态 B 拆到 R-4 子资源分页，R-1 只返回组与成员。
 */
export interface TaskGroupQueryCommand {
  readonly actorUserId: number;
  readonly groupId: number;
}

export interface TaskGroupRecordQueryCommand {
  readonly actorUserId: number;
  readonly groupId: number;
  readonly memberTaskId?: number;
  readonly cursor?: string;
  readonly limit?: number;
}

function notFoundError(): AggregateReadError {
  return new AggregateReadError(
    404,
    "TASK_GROUP_NOT_FOUND",
    "任务聚合组不存在或当前用户无权访问",
  );
}

function inconsistentError(detail: string): AggregateReadError {
  return new AggregateReadError(
    500,
    "AGGREGATE_READ_INCONSISTENT",
    "聚合读数据不完整，无法完成查询：" + detail,
  );
}

function toUserRef(user: UserRefItem): {
  readonly userId: number;
  readonly name: string;
  readonly avatarUrl: string | null;
} {
  return { userId: user.userId, name: user.name, avatarUrl: user.avatarUrl };
}

function toGroupSummary(group: TaskGroupReadRecord): TaskGroupSummary {
  return {
    groupId: group.groupId,
    projectId: group.projectId,
    code: group.code,
    name: group.name,
    status: group.status,
    createdAt: group.createdAt.toISOString(),
    closedAt: group.closedAt === null ? null : group.closedAt.toISOString(),
    rowVersion: group.rowVersion,
  };
}

/**
 * 成员排序由服务端固定：主任务在前，来源任务按 joinedAt 升序、taskId 升序。
 * 成员任务或负责人缺失属于不可达的数据不变量破损（成员表对 tasks 有外键、
 * 用户只停用不删除），此时显式失败而不是静默丢行。
 */
function toMemberDetails(
  members: readonly TaskGroupMemberRow[],
  taskById: ReadonlyMap<number, TaskReadModel>,
  countByTask: ReadonlyMap<number, number>,
  userById: ReadonlyMap<number, UserRefItem>,
): TaskGroupMemberDetail[] {
  const sorted = [...members].sort((left, right) => {
    if (left.role !== right.role) {
      return left.role === "MAIN" ? -1 : 1;
    }
    const joinedDelta = left.joinedAt.getTime() - right.joinedAt.getTime();
    if (joinedDelta !== 0) {
      return joinedDelta;
    }
    return left.taskId - right.taskId;
  });
  return sorted.map((member) => {
    const task = taskById.get(member.taskId);
    if (task === undefined) {
      throw inconsistentError(
        "聚合组成员缺少对应任务 " + String(member.taskId),
      );
    }
    const assignee = userById.get(task.assigneeId);
    if (assignee === undefined) {
      throw inconsistentError("任务负责人不存在 " + String(task.assigneeId));
    }
    return {
      taskId: task.taskId,
      taskCode: task.code,
      title: task.title,
      role: member.role,
      sourceKind: member.sourceKind,
      memberStatus: member.status,
      workStatus: task.workStatus,
      lifecycleStatus: task.lifecycleStatus,
      moduleId: task.moduleId,
      featureId: task.featureId,
      assignee: toUserRef(assignee),
      joinedAt: member.joinedAt.toISOString(),
      detachedAt:
        member.detachedAt === null ? null : member.detachedAt.toISOString(),
      detachReason: member.detachReason,
      publishedRecordCount: countByTask.get(task.taskId) ?? 0,
    };
  });
}

function toRecordLink(link: ChangeRecordLinkRow): TaskGroupRecordLink {
  return {
    linkId: link.linkId,
    displayUrl: link.displayUrl,
    kind: link.kind,
    repository: link.repository,
    externalNumber: link.externalNumber,
    externalSha: link.externalSha,
    titleSnapshot: link.titleSnapshot,
    stateSnapshot: link.stateSnapshot,
    createdAt: link.createdAt.toISOString(),
  };
}

@Injectable()
export class TaskGroupQueryService {
  constructor(
    @Inject(PROJECT_ACCESS_QUERY_PORT)
    private readonly projectAccess: ProjectAccessQueryPort,
    @Inject(TaskGroupReadPort) private readonly groups: TaskGroupReadPort,
    @Inject(TaskQueryPort) private readonly tasks: TaskQueryPort,
    @Inject(ChangeRecordReadPort)
    private readonly records: ChangeRecordReadPort,
    @Inject(UserReadPort) private readonly users: UserReadPort,
    @Inject(ExternalLinksQueryPort)
    private readonly links: ExternalLinksQueryPort,
    @Inject(PostgresUnitOfWork) private readonly unitOfWork: UnitOfWork,
    private readonly cursor: AggregateReadCursorService,
  ) {}

  async getTaskGroup(
    command: TaskGroupQueryCommand,
  ): Promise<TaskGroupDetailResponse> {
    const scope = await this.projectAccess.getAuthorizedSearchScope(
      command.actorUserId,
    );
    return this.unitOfWork.run(async (tx) => {
      const group = await this.groups.findGroupById(tx, command.groupId);
      if (group === undefined || !scope.projectIds.includes(group.projectId)) {
        throw notFoundError();
      }
      const members = await this.groups.listMembers(
        tx,
        group.projectId,
        group.groupId,
      );
      const taskIds = members.map((member) => member.taskId);
      const taskRows = await this.tasks.listByIds(
        tx,
        [group.projectId],
        taskIds,
      );
      const counts = await this.countPublishedByTask(
        tx,
        group.projectId,
        taskIds,
      );
      const assignees = await this.users.listByIds(tx, [
        ...new Set(taskRows.map((row) => row.assigneeId)),
      ]);
      return {
        group: toGroupSummary(group),
        members: toMemberDetails(
          members,
          new Map(taskRows.map((row) => [row.taskId, row])),
          new Map(counts.map((item) => [item.taskId, item.count])),
          new Map(assignees.map((item) => [item.userId, item])),
        ),
      };
    });
  }

  async listTaskGroupRecords(
    command: TaskGroupRecordQueryCommand,
  ): Promise<TaskGroupRecordPage> {
    const scope = await this.projectAccess.getAuthorizedSearchScope(
      command.actorUserId,
    );
    const limit = command.limit ?? AGGREGATE_READ_PAGE_LIMIT_DEFAULT;
    const filterKey =
      "TASK_GROUP_RECORDS:" +
      String(command.groupId) +
      ":" +
      (command.memberTaskId === undefined
        ? "all"
        : String(command.memberTaskId));
    return this.unitOfWork.run(async (tx) => {
      const group = await this.groups.findGroupById(tx, command.groupId);
      if (group === undefined || !scope.projectIds.includes(group.projectId)) {
        throw notFoundError();
      }
      const members = await this.groups.listMembers(
        tx,
        group.projectId,
        group.groupId,
      );
      const memberTaskIds = members.map((member) => member.taskId);
      const taskIds =
        command.memberTaskId === undefined
          ? memberTaskIds
          : memberTaskIds.filter((taskId) => taskId === command.memberTaskId);
      const afterRecordId = this.decodeCursor(
        command.cursor,
        command.actorUserId,
        filterKey,
      );
      const page = await this.records.listVisibleRecordsByTaskIds(tx, {
        projectId: group.projectId,
        taskIds,
        limit,
        ...(afterRecordId === null ? {} : { afterRecordId }),
      });
      const links = await this.links.listChangeRecordLinks(
        tx,
        group.projectId,
        page.items.map((item) => item.recordId),
      );
      const pageTaskIds = [...new Set(page.items.map((item) => item.taskId))];
      const pageTasks = await this.tasks.listByIds(
        tx,
        [group.projectId],
        pageTaskIds,
      );
      const taskCodeById = new Map(
        pageTasks.map((task) => [task.taskId, task.code]),
      );
      const roleByTask = new Map(
        members.map((member) => [member.taskId, member.role]),
      );
      const linksByRecord = new Map<number, TaskGroupRecordLink[]>();
      for (const link of links) {
        const bucket = linksByRecord.get(link.recordId);
        if (bucket === undefined) {
          linksByRecord.set(link.recordId, [toRecordLink(link)]);
          continue;
        }
        bucket.push(toRecordLink(link));
      }
      const items: TaskGroupRecordItem[] = page.items.map((row) => ({
        recordId: row.recordId,
        code: row.code,
        title: row.title,
        recordStatus: row.status,
        taskId: row.taskId,
        sourceLabel: this.sourceLabel(row.taskId, roleByTask, taskCodeById),
        featureId: row.featureId,
        publishedAt: row.publishedAt.toISOString(),
        externalLinks: linksByRecord.get(row.recordId) ?? [],
      }));
      return {
        items,
        nextCursor:
          page.nextRecordId === null
            ? null
            : this.cursor.encode({
                actorUserId: command.actorUserId,
                namespace: "TASK_GROUP_RECORDS",
                filterKey,
                afterId: page.nextRecordId,
              }),
        hasMore: page.hasMore,
      };
    });
  }

  private async countPublishedByTask(
    tx: TransactionContext,
    projectId: number,
    taskIds: readonly number[],
  ): Promise<readonly TaskPublishedRecordCountItem[]> {
    return this.records.countPublishedByTask(tx, [projectId], taskIds);
  }

  private sourceLabel(
    taskId: number,
    roleByTask: ReadonlyMap<number, "MAIN" | "SOURCE">,
    taskCodeById: ReadonlyMap<number, string>,
  ): string {
    if (roleByTask.get(taskId) === "MAIN") {
      return "主任务";
    }
    const code = taskCodeById.get(taskId);
    if (code === undefined) {
      throw inconsistentError("聚合组记录缺少来源任务 " + String(taskId));
    }
    return code;
  }

  private decodeCursor(
    cursor: string | undefined,
    actorUserId: number,
    filterKey: string,
  ): number | null {
    try {
      return this.cursor.decode(cursor, {
        actorUserId,
        namespace: "TASK_GROUP_RECORDS",
        filterKey,
      });
    } catch (error) {
      if (error instanceof AggregateReadCursorError) {
        throw invalidCursorError();
      }
      throw error;
    }
  }
}
