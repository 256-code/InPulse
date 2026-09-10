import { Injectable } from "@nestjs/common";
import { taskGroupItemSchema, type TaskGroupItem } from "@inpulse/api-contract";
import type { TransactionContext } from "../../database/transaction-context.js";

export interface TaskGroupRecord {
  groupId: number;
  projectId: number;
  code: string;
  name: string;
  status: "ACTIVE" | "CLOSED";
  createdBy: number;
  rowVersion: number;
  createdAt: Date;
  updatedAt: Date;
  closedAt: Date | null;
}
export interface TaskGroupMemberRecord {
  memberId: number;
  groupId: number;
  taskId: number;
  projectId: number;
  role: "MAIN" | "SOURCE";
  sourceKind: "ACTIVE" | "HISTORICAL" | null;
  status: "ACTIVE" | "DETACHED";
  originalWorkStatus: "TODO" | "DONE" | "CANCELED" | null;
  originalAssigneeId: number | null;
  joinedAt: Date;
  detachedAt: Date | null;
  detachReason: string | null;
}
export interface CreateTaskGroupInput {
  projectId: number;
  code: string;
  name: string;
  createdBy: number;
}
export interface DetachTaskGroupMemberInput {
  projectId: number;
  memberId: number;
  detachedBy: number;
  reason: string;
}
export interface CreateTaskGroupMemberInput {
  groupId: number;
  taskId: number;
  projectId: number;
  role: "MAIN" | "SOURCE";
  sourceKind: "ACTIVE" | "HISTORICAL" | null;
  originalWorkStatus: "TODO" | "DONE" | "CANCELED" | null;
  originalAssigneeId: number | null;
}
/**
 * 只负责 task_groups / task_group_members 的持久化，不决定业务状态流转。
 * 组内成员变更必须先持有该 group 行锁（技术设计 6.5：新增与解除必须串行化）。
 */
@Injectable()
export class TaskGroupRepository {
  async findGroup(
    tx: TransactionContext,
    projectId: number,
    groupId: number,
  ): Promise<TaskGroupRecord | undefined> {
    const [row] = await tx.sql<
      TaskGroupRecord[]
    >`SELECT id AS "groupId",project_id AS "projectId",code,name,status,created_by AS "createdBy",row_version AS "rowVersion",created_at AS "createdAt",updated_at AS "updatedAt",closed_at AS "closedAt" FROM app.task_groups WHERE id=${groupId} AND project_id=${projectId}`;
    return row;
  }
  async lockGroup(
    tx: TransactionContext,
    projectId: number,
    groupId: number,
  ): Promise<TaskGroupRecord | undefined> {
    await tx.sql`SELECT id FROM app.task_groups WHERE id=${groupId} AND project_id=${projectId} FOR UPDATE`;
    // 独立 READ COMMITTED 语句能看到等锁期间提交的成员变更。
    return this.findGroup(tx, projectId, groupId);
  }
  async findActiveMember(
    tx: TransactionContext,
    projectId: number,
    taskId: number,
  ): Promise<TaskGroupMemberRecord | undefined> {
    const [row] = await tx.sql<
      TaskGroupMemberRecord[]
    >`SELECT id AS "memberId",group_id AS "groupId",task_id AS "taskId",project_id AS "projectId",role,source_kind AS "sourceKind",status,original_work_status AS "originalWorkStatus",original_assignee_id AS "originalAssigneeId",joined_at AS "joinedAt",detached_at AS "detachedAt",detach_reason AS "detachReason" FROM app.task_group_members WHERE project_id=${projectId} AND task_id=${taskId} AND status='ACTIVE'`;
    return row;
  }
  async listMembers(
    tx: TransactionContext,
    projectId: number,
    groupId: number,
  ): Promise<TaskGroupMemberRecord[]> {
    return tx.sql<
      TaskGroupMemberRecord[]
    >`SELECT id AS "memberId",group_id AS "groupId",task_id AS "taskId",project_id AS "projectId",role,source_kind AS "sourceKind",status,original_work_status AS "originalWorkStatus",original_assignee_id AS "originalAssigneeId",joined_at AS "joinedAt",detached_at AS "detachedAt",detach_reason AS "detachReason" FROM app.task_group_members WHERE project_id=${projectId} AND group_id=${groupId} ORDER BY id`;
  }
  async listActiveMemberTaskIds(
    tx: TransactionContext,
    projectId: number,
    groupId: number,
  ): Promise<number[]> {
    const rows = await tx.sql<
      { taskId: number }[]
    >`SELECT task_id AS "taskId" FROM app.task_group_members WHERE project_id=${projectId} AND group_id=${groupId} AND status='ACTIVE' ORDER BY task_id`;
    return rows.map((row) => row.taskId);
  }
  async createGroup(
    tx: TransactionContext,
    input: CreateTaskGroupInput,
  ): Promise<TaskGroupRecord> {
    const [row] = await tx.sql<
      { groupId: number }[]
    >`INSERT INTO app.task_groups (project_id, code, name, created_by) VALUES (${input.projectId}, ${input.code}, ${input.name}, ${input.createdBy}) RETURNING id AS "groupId"`;
    const group = await this.findGroup(tx, input.projectId, row!.groupId);
    if (!group) throw new Error("Task group vanished after insert");
    return group;
  }
  async createMember(
    tx: TransactionContext,
    input: CreateTaskGroupMemberInput,
  ): Promise<TaskGroupMemberRecord> {
    const [row] = await tx.sql<
      TaskGroupMemberRecord[]
    >`INSERT INTO app.task_group_members (group_id, task_id, project_id, role, source_kind, original_work_status, original_assignee_id) VALUES (${input.groupId}, ${input.taskId}, ${input.projectId}, ${input.role}, ${input.sourceKind}, ${input.originalWorkStatus}, ${input.originalAssigneeId}) RETURNING id AS "memberId",group_id AS "groupId",task_id AS "taskId",project_id AS "projectId",role,source_kind AS "sourceKind",status,original_work_status AS "originalWorkStatus",original_assignee_id AS "originalAssigneeId",joined_at AS "joinedAt",detached_at AS "detachedAt",detach_reason AS "detachReason"`;
    return row!;
  }
  /**
   * 组内成员变化：条件更新递增 row_version，供后续 F-24/F-25 的乐观并发使用。
   * 调用方必须已持有该 group 行锁；返回 false 表示组状态在锁内已被改变。
   */
  async touchGroup(
    tx: TransactionContext,
    projectId: number,
    groupId: number,
    expectedRowVersion: number,
  ): Promise<boolean> {
    const rows =
      await tx.sql`UPDATE app.task_groups SET row_version=row_version+1,updated_at=GREATEST(clock_timestamp(),updated_at) WHERE id=${groupId} AND project_id=${projectId} AND status='ACTIVE' AND row_version=${expectedRowVersion} RETURNING id`;
    return rows.length > 0;
  }
  /**
   * 解除成员：条件更新保证只有 ACTIVE 成员能被解除，重复解除不会二次生效。
   * detached_at 取 max(事务时钟, joined_at)，不依赖客户端时间且不违反
   * task_group_members_detach_time_check。
   */
  async detachMember(
    tx: TransactionContext,
    input: DetachTaskGroupMemberInput,
  ): Promise<TaskGroupMemberRecord | undefined> {
    const [row] = await tx.sql<
      TaskGroupMemberRecord[]
    >`UPDATE app.task_group_members SET status='DETACHED',detached_at=GREATEST(clock_timestamp(),joined_at),detached_by=${input.detachedBy},detach_reason=${input.reason} WHERE id=${input.memberId} AND project_id=${input.projectId} AND status='ACTIVE' RETURNING id AS "memberId",group_id AS "groupId",task_id AS "taskId",project_id AS "projectId",role,source_kind AS "sourceKind",status,original_work_status AS "originalWorkStatus",original_assignee_id AS "originalAssigneeId",joined_at AS "joinedAt",detached_at AS "detachedAt",detach_reason AS "detachReason"`;
    return row;
  }
  /**
   * 关闭聚合组：仅在组仍 ACTIVE 且版本未变时生效，调用方必须已持有该 group 行锁；
   * 返回 undefined 表示组状态在锁内已被改变，由服务层映射为 409。
   */
  async closeGroup(
    tx: TransactionContext,
    projectId: number,
    groupId: number,
    expectedRowVersion: number,
  ): Promise<TaskGroupRecord | undefined> {
    const rows =
      await tx.sql`UPDATE app.task_groups SET status='CLOSED',closed_at=GREATEST(clock_timestamp(),created_at),row_version=row_version+1,updated_at=GREATEST(clock_timestamp(),updated_at) WHERE id=${groupId} AND project_id=${projectId} AND status='ACTIVE' AND row_version=${expectedRowVersion} RETURNING id`;
    if (rows.length === 0) return undefined;
    return this.findGroup(tx, projectId, groupId);
  }
  /** 合并结果 DTO；形状约束保证 ACTIVE 组恰好一个活跃 MAIN 成员。 */
  async findGroupItem(
    tx: TransactionContext,
    projectId: number,
    groupId: number,
  ): Promise<TaskGroupItem | undefined> {
    const group = await this.findGroup(tx, projectId, groupId);
    if (!group) return undefined;
    const members = await this.listMembers(tx, projectId, groupId);
    const activeMain = members.find(
      (member) => member.role === "MAIN" && member.status === "ACTIVE",
    );
    if (!activeMain) throw new Error("active task group has no active MAIN");
    return taskGroupItemSchema.parse({
      id: group.groupId,
      projectId: group.projectId,
      code: group.code,
      name: group.name,
      status: group.status,
      createdBy: group.createdBy,
      rowVersion: group.rowVersion,
      createdAt: new Date(group.createdAt).toISOString(),
      updatedAt: new Date(group.updatedAt).toISOString(),
      mainTaskId: activeMain.taskId,
      members: members.map((member) => ({
        id: member.memberId,
        taskId: member.taskId,
        role: member.role,
        sourceKind: member.sourceKind,
        status: member.status,
        originalWorkStatus: member.originalWorkStatus,
        originalAssigneeId: member.originalAssigneeId,
        joinedAt: new Date(member.joinedAt).toISOString(),
      })),
    });
  }
}
