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
  /** Caller already authorizes and locks project/module/feature, then locks task for edits.
   * Locks user then membership FOR SHARE; only for creation or changed assignee.
   * Never use this to invalidate an unchanged historical assignee.
   */
  abstract checkAssignableMember(
    tx: TransactionContext,
    input: { projectId: number; userId: number },
  ): Promise<"allowed" | "not-found">;
}
