import type { TransactionContext } from "../../database/transaction-context.js";
import {
  ProjectMembersQueryPort,
  type AssignableProjectMember,
} from "./project-members-query.port.js";

export class PostgresProjectMembersQueryPort extends ProjectMembersQueryPort {
  async listActiveMembers(
    tx: TransactionContext,
    input: { actorUserId: number; projectId: number },
  ): Promise<AssignableProjectMember[] | undefined> {
    const [authorized] =
      await tx.sql`SELECT 1 FROM app.projects p JOIN app.users actor ON actor.id = ${input.actorUserId} AND actor.status = 'ACTIVE' AND actor.disabled_at IS NULL WHERE p.id = ${input.projectId} AND (actor.is_admin OR EXISTS (SELECT 1 FROM app.project_members m WHERE m.project_id = p.id AND m.user_id = actor.id AND m.status = 'ACTIVE'))`;
    if (!authorized) return undefined;
    return tx.sql<
      AssignableProjectMember[]
    >`SELECT u.id, u.name, u.avatar_url AS "avatarUrl" FROM app.users u WHERE u.status = 'ACTIVE' AND u.disabled_at IS NULL AND EXISTS (SELECT 1 FROM app.project_members m WHERE m.project_id = ${input.projectId} AND m.user_id = u.id AND m.status = 'ACTIVE') ORDER BY u.id`;
  }
  async checkAssignableMember(
    tx: TransactionContext,
    input: { projectId: number; userId: number },
  ): Promise<"allowed" | "not-found"> {
    const [user] =
      await tx.sql`SELECT id FROM app.users WHERE id = ${input.userId} AND status = 'ACTIVE' AND disabled_at IS NULL FOR SHARE`;
    if (!user) return "not-found";
    const [member] =
      await tx.sql`SELECT id FROM app.project_members WHERE project_id = ${input.projectId} AND user_id = ${input.userId} AND status = 'ACTIVE' FOR SHARE`;
    return member ? "allowed" : "not-found";
  }
}
