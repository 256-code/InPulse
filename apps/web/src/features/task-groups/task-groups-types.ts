import type {
  TaskGroupDetailResponse,
  TaskGroupMemberDetail,
  TaskGroupRecordPage,
} from "@generated/api";

/**
 * F-23 / F-24 / F-25 任务聚合组前端数据层（C 岗位）。
 *
 * 数据来源为已落库的 C 域读取契约（A 裁决见 docs/a-contract-review-f25-f29-f32.md）：
 * R-1 GET /api/v1/task-groups/{groupId}、R-4
 * GET /api/v1/task-groups/{groupId}/records。视图直接消费服务端字段，
 * 不复制任务或记录实体，也不展示原始审计内容（工作书 F-25 禁止事项）。
 */

export interface TaskGroupRecordsQuery {
  readonly memberTaskId?: number;
  readonly cursor?: string;
}

export interface TaskGroupAdapter {
  readonly source: "server";
  readonly notice: string;
  fetchTaskGroup(groupId: number): Promise<TaskGroupDetailResponse>;
  fetchTaskGroupRecords(
    groupId: number,
    query: TaskGroupRecordsQuery,
  ): Promise<TaskGroupRecordPage>;
}

export type TaskGroupMember = TaskGroupMemberDetail;

/** 成员角色标签；sourceKind 只在 SOURCE 上非空，已解除关系仍保留类型描述。 */
export function memberRoleLabel(member: TaskGroupMember): string {
  if (member.role === "MAIN")
    return member.memberStatus === "DETACHED" ? "主任务（已解除）" : "主任务";
  const kind =
    member.sourceKind === "HISTORICAL" ? "历史来源分支" : "活动来源分支";
  return member.memberStatus === "DETACHED" ? kind + "（已解除）" : kind;
}
