import { Inject, Injectable } from "@nestjs/common";
import type { TransactionContext } from "../../database/transaction-context.js";
import { TaskBranchQueryPort } from "./task-branch-query.port.js";
import { TaskGroupRepository } from "./task-group.repository.js";

/**
 * ADR-058：删除任务前对活跃聚合关系的处理结果。
 * - `none`：任务不在活跃聚合组内（含组已关闭）。
 * - `detached`：来源任务已标记解除；`closedGroup` 为真表示它原本是最后一个来源，
 *   组连同主任务已按「解除合并」的既有语义关闭。
 * - `blocked`：主任务必须先解除合并；`conflict` 表示关系在锁内被并发改动。
 */
export type TaskGroupDeletionOutcome =
  | { readonly kind: "none" }
  | {
      readonly kind: "detached";
      readonly groupId: number;
      readonly closedGroup: boolean;
    }
  | {
      readonly kind: "blocked";
      readonly groupId: number;
      readonly reason: "main" | "conflict";
    };

/** ADR-058：任务删除对聚合组域的写入边界，由 task-groups 域实现。 */
export abstract class TaskGroupDeletionPort {
  abstract prepareTaskDeletion(
    tx: TransactionContext,
    input: {
      readonly projectId: number;
      readonly taskId: number;
      readonly actorId: number;
      readonly reason: string;
    },
  ): Promise<TaskGroupDeletionOutcome>;
}

/**
 * 复用「解除合并」已冻结的写入语义：来源任务标记 DETACHED 并写解除时间与原因；
 * 最后一个来源解除时同时解除主任务并关闭聚合组。主任务自身必须先解除合并，
 * 直接删除会被拒绝而不是隐式拆组。
 */
@Injectable()
export class SqlTaskGroupDeletionPort extends TaskGroupDeletionPort {
  constructor(
    @Inject(TaskBranchQueryPort)
    private readonly branches: TaskBranchQueryPort,
    @Inject(TaskGroupRepository)
    private readonly groups: TaskGroupRepository,
  ) {
    super();
  }

  async prepareTaskDeletion(
    tx: TransactionContext,
    input: {
      readonly projectId: number;
      readonly taskId: number;
      readonly actorId: number;
      readonly reason: string;
    },
  ): Promise<TaskGroupDeletionOutcome> {
    const branch = await this.branches.find(tx, input.projectId, input.taskId);
    if (!branch) return { kind: "none" };
    if (branch.role === "MAIN")
      return { kind: "blocked", groupId: branch.groupId, reason: "main" };
    const group = await this.groups.lockGroup(
      tx,
      input.projectId,
      branch.groupId,
    );
    if (!group) return { kind: "none" };
    const member = await this.groups.findActiveMember(
      tx,
      input.projectId,
      input.taskId,
    );
    if (!member) return { kind: "none" };
    const members = await this.groups.listMembers(
      tx,
      input.projectId,
      group.groupId,
    );
    const mainMember = members.find(
      (entry) => entry.status === "ACTIVE" && entry.role === "MAIN",
    );
    const remainingSources = members.filter(
      (entry) =>
        entry.status === "ACTIVE" &&
        entry.role === "SOURCE" &&
        entry.memberId !== member.memberId,
    );
    const detachedSource = await this.groups.detachMember(tx, {
      projectId: input.projectId,
      memberId: member.memberId,
      detachedBy: input.actorId,
      reason: input.reason,
    });
    if (!detachedSource)
      return { kind: "blocked", groupId: group.groupId, reason: "conflict" };
    if (remainingSources.length > 0) {
      const touched = await this.groups.touchGroup(
        tx,
        input.projectId,
        group.groupId,
        group.rowVersion,
      );
      if (!touched)
        return { kind: "blocked", groupId: group.groupId, reason: "conflict" };
      return { kind: "detached", groupId: group.groupId, closedGroup: false };
    }
    if (!mainMember)
      return { kind: "blocked", groupId: group.groupId, reason: "conflict" };
    const detachedMain = await this.groups.detachMember(tx, {
      projectId: input.projectId,
      memberId: mainMember.memberId,
      detachedBy: input.actorId,
      reason: input.reason,
    });
    if (!detachedMain)
      return { kind: "blocked", groupId: group.groupId, reason: "conflict" };
    const closed = await this.groups.closeGroup(
      tx,
      input.projectId,
      group.groupId,
      group.rowVersion,
    );
    if (!closed)
      return { kind: "blocked", groupId: group.groupId, reason: "conflict" };
    return { kind: "detached", groupId: group.groupId, closedGroup: true };
  }
}
