import type { TransactionContext } from "../../database/transaction-context.js";

export interface TaskGroupRoleItem {
  readonly taskId: number;
  readonly groupId: number;
  readonly role: "MAIN" | "SOURCE";
}

/**
 * C 域聚合读所需的任务聚合组只读端口（A 裁决 §6 冲突 B、Q-04 与 Q-11）。
 *
 * 约定：
 * 1. 只读、不取锁；不校验项目授权，调用方必须先取得 AuthorizedProjectScope。
 * 2. projectIds 为空时短路返回空集，不发出任何 SQL。
 * 3. 只统计 ACTIVE 组内的 ACTIVE 成员关系：解除合并（DETACHED）后任务恢复为
 *    独立任务，不再计入历史来源排除集合，也不再返回组角色。
 * 4. SQL 同时带成员表与组表的 project_id 条件，跨项目串联不会返回结果。
 */
export abstract class TaskGroupMembershipReadPort {
  /**
   * 功能设计 §29.1「历史来源分支」的排除集合：ACTIVE 组内仍处于 ACTIVE 关系的
   * source_kind = 'HISTORICAL' 来源任务。调用方把它作为 excludedTaskIds 传给 B 侧
   * 任务查询端口，保证先过滤后分页，不在应用层过滤。
   */
  abstract listHistoricalSourceTaskIds(
    tx: TransactionContext,
    projectIds: readonly number[],
  ): Promise<readonly number[]>;

  /** 任务 -> 组内角色映射（F-32 任务卡片「主任务/来源任务」标记）。 */
  abstract listGroupRoles(
    tx: TransactionContext,
    projectIds: readonly number[],
    taskIds: readonly number[],
  ): Promise<readonly TaskGroupRoleItem[]>;
}

export class PostgresTaskGroupMembershipReadPort extends TaskGroupMembershipReadPort {
  async listHistoricalSourceTaskIds(
    tx: TransactionContext,
    projectIds: readonly number[],
  ): Promise<readonly number[]> {
    if (projectIds.length === 0) {
      return [];
    }
    const ids = [...projectIds];
    const rows = await tx.sql<{ taskId: number }[]>`
      SELECT m.task_id AS "taskId"
        FROM app.task_group_members m
        JOIN app.task_groups g
          ON g.id = m.group_id
         AND g.project_id = m.project_id
       WHERE m.project_id = ANY(${ids}::integer[])
         AND g.status = 'ACTIVE'
         AND m.status = 'ACTIVE'
         AND m.role = 'SOURCE'
         AND m.source_kind = 'HISTORICAL'
       ORDER BY m.task_id ASC
`;
    return rows.map((row) => row.taskId);
  }

  async listGroupRoles(
    tx: TransactionContext,
    projectIds: readonly number[],
    taskIds: readonly number[],
  ): Promise<readonly TaskGroupRoleItem[]> {
    if (projectIds.length === 0 || taskIds.length === 0) {
      return [];
    }
    const ids = [...projectIds];
    const tasks = [...taskIds];
    return (await tx.sql<TaskGroupRoleItem[]>`
      SELECT m.task_id AS "taskId", m.group_id AS "groupId", m.role
        FROM app.task_group_members m
        JOIN app.task_groups g
          ON g.id = m.group_id
         AND g.project_id = m.project_id
       WHERE m.project_id = ANY(${ids}::integer[])
         AND g.status = 'ACTIVE'
         AND m.status = 'ACTIVE'
         AND m.task_id = ANY(${tasks}::integer[])
       ORDER BY m.task_id ASC
`) as unknown as readonly TaskGroupRoleItem[];
  }
}
