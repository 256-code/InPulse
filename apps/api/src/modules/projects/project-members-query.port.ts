import type { TransactionContext } from "../../database/transaction-context.js";

export interface AssignableProjectMember {
  readonly id: number;
  readonly name: string;
  readonly avatarUrl: string | null;
}
export abstract class ProjectMembersQueryPort {
  /** Reauthorizes inside tx; undefined means project missing or inaccessible. */
  abstract listActiveMembers(
    tx: TransactionContext,
    input: { actorUserId: number; projectId: number },
  ): Promise<AssignableProjectMember[] | undefined>;
  /**
   * ADR-035：列出项目全部 ACTIVE 成员的 userId（按 id 升序），供项目开工时
   * 通知全体成员。调用方已持有项目锁并完成写权限校验，这里不再二次授权。
   */
  abstract listActiveMemberIds(
    tx: TransactionContext,
    input: { readonly projectId: number },
  ): Promise<readonly number[]>;
  /**
   * ADR-033：读取指定用户在项目内的 ACTIVE 成员角色；无 ACTIVE 成员关系
   * （含非成员与已移除）返回 undefined。调用方已持有事务与项目锁。
   */
  abstract findActiveRole(
    tx: TransactionContext,
    input: { projectId: number; userId: number },
  ): Promise<"MEMBER" | "PROJECT_ADMIN" | "LEADER" | undefined>;
  /** Caller already authorizes and locks project/module/feature, then locks task for edits.
   * Locks user then membership FOR SHARE; only for creation or changed assignee.
   * Never use this to invalidate an unchanged historical assignee.
   */
  abstract checkAssignableMember(
    tx: TransactionContext,
    input: { projectId: number; userId: number },
  ): Promise<"allowed" | "not-found">;
}
