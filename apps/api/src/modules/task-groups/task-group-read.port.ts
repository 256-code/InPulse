import { Inject, Injectable } from "@nestjs/common";
import type { TransactionContext } from "../../database/transaction-context.js";
import { TaskGroupRepository } from "./task-group.repository.js";

export interface TaskGroupReadRecord {
  readonly groupId: number;
  readonly projectId: number;
  readonly code: string;
  readonly name: string;
  readonly status: "ACTIVE" | "CLOSED";
  readonly rowVersion: number;
  readonly createdAt: Date;
  readonly closedAt: Date | null;
}

export interface TaskGroupMemberRow {
  readonly memberId: number;
  readonly taskId: number;
  readonly role: "MAIN" | "SOURCE";
  readonly sourceKind: "ACTIVE" | "HISTORICAL" | null;
  readonly status: "ACTIVE" | "DETACHED";
  readonly joinedAt: Date;
  readonly detachedAt: Date | null;
  readonly detachReason: string | null;
}

/** R-7 聚合组列表入参；projectIds 必须来自服务端 AuthorizedProjectScope。 */
export interface TaskGroupListReadInput {
  readonly projectIds: readonly number[];
  readonly limit: number;
  readonly afterGroupId?: number;
}

/** R-7 分页结果：hasMore 为 true 时 nextGroupId 是最后一条的 keyset 位置。 */
export interface TaskGroupListPage {
  readonly items: readonly TaskGroupReadRecord[];
  readonly nextGroupId: number | null;
  readonly hasMore: boolean;
}

/** R-7 分支摘要行：只含 ACTIVE 成员，同时保留 role / sourceKind 由契约层映射。 */
export interface TaskGroupActiveMemberRow extends TaskGroupMemberRow {
  readonly groupId: number;
}

/**
 * C 域聚合读（R-1 / R-4）的组与成员只读端口。
 *
 * 约定：
 * 1. 只读、不取锁；不校验项目授权，调用方必须先取得 AuthorizedProjectScope。
 * 2. findGroupById 项目无关，供 R-1 由全局 groupId 反查归属；不在授权范围时
 *    调用方统一按 404 处理。
 * 3. listMembers 返回组内全部成员（含已解除 DETACHED），不按状态过滤；
 *    SQL 同时带 project_id 与 group_id 条件，跨项目串联不会返回结果。
 * 4. 时间列在适配器边界统一还原为 Date（与 B 侧读端口同一约定）。
 */
export abstract class TaskGroupReadPort {
  abstract findGroupById(
    tx: TransactionContext,
    groupId: number,
  ): Promise<TaskGroupReadRecord | undefined>;

  abstract listMembers(
    tx: TransactionContext,
    projectId: number,
    groupId: number,
  ): Promise<readonly TaskGroupMemberRow[]>;

  /**
   * R-7 聚合组列表：只返回授权项目范围内的组，固定 groupId DESC keyset 分页。
   * 只读、不取锁；projectIds 为空短路返回空页，不发出 SQL。
   */
  abstract listGroups(
    tx: TransactionContext,
    input: TaskGroupListReadInput,
  ): Promise<TaskGroupListPage>;

  /**
   * R-7 分支摘要：只返回 status = ACTIVE 的成员（不含 DETACHED）；SQL 同时带
   * project_id 与 group_id 条件，跨项目串联不会返回结果。
   */
  abstract listActiveMembersForGroups(
    tx: TransactionContext,
    projectIds: readonly number[],
    groupIds: readonly number[],
  ): Promise<readonly TaskGroupActiveMemberRow[]>;
}

@Injectable()
export class PostgresTaskGroupReadPort extends TaskGroupReadPort {
  constructor(
    @Inject(TaskGroupRepository)
    private readonly repository: TaskGroupRepository,
  ) {
    super();
  }

  async findGroupById(
    tx: TransactionContext,
    groupId: number,
  ): Promise<TaskGroupReadRecord | undefined> {
    const group = await this.repository.findGroupById(tx, groupId);
    if (group === undefined) {
      return undefined;
    }
    return {
      groupId: group.groupId,
      projectId: group.projectId,
      code: group.code,
      name: group.name,
      status: group.status,
      rowVersion: group.rowVersion,
      createdAt: new Date(group.createdAt),
      closedAt: group.closedAt === null ? null : new Date(group.closedAt),
    };
  }

  async listMembers(
    tx: TransactionContext,
    projectId: number,
    groupId: number,
  ): Promise<readonly TaskGroupMemberRow[]> {
    const members = await this.repository.listMembers(tx, projectId, groupId);
    return members.map((member) => ({
      memberId: member.memberId,
      taskId: member.taskId,
      role: member.role,
      sourceKind: member.sourceKind,
      status: member.status,
      joinedAt: new Date(member.joinedAt),
      detachedAt:
        member.detachedAt === null ? null : new Date(member.detachedAt),
      detachReason: member.detachReason,
    }));
  }

  async listGroups(
    tx: TransactionContext,
    input: TaskGroupListReadInput,
  ): Promise<TaskGroupListPage> {
    const rows = await this.repository.listGroupsPage(
      tx,
      input.projectIds,
      input.limit,
      input.afterGroupId,
    );
    const hasMore = rows.length > input.limit;
    const visible = hasMore ? rows.slice(0, input.limit) : rows;
    const items = visible.map((group) => ({
      groupId: group.groupId,
      projectId: group.projectId,
      code: group.code,
      name: group.name,
      status: group.status,
      rowVersion: group.rowVersion,
      createdAt: new Date(group.createdAt),
      closedAt: group.closedAt === null ? null : new Date(group.closedAt),
    }));
    const last = items.length === 0 ? null : items[items.length - 1]!;
    return {
      items,
      hasMore,
      nextGroupId: hasMore && last !== null ? last.groupId : null,
    };
  }

  async listActiveMembersForGroups(
    tx: TransactionContext,
    projectIds: readonly number[],
    groupIds: readonly number[],
  ): Promise<readonly TaskGroupActiveMemberRow[]> {
    const members = await this.repository.listActiveMembersForGroups(
      tx,
      projectIds,
      groupIds,
    );
    return members.map((member) => ({
      memberId: member.memberId,
      groupId: member.groupId,
      taskId: member.taskId,
      role: member.role,
      sourceKind: member.sourceKind,
      status: member.status,
      joinedAt: new Date(member.joinedAt),
      detachedAt:
        member.detachedAt === null ? null : new Date(member.detachedAt),
      detachReason: member.detachReason,
    }));
  }
}
