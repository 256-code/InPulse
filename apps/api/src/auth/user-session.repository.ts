import type { TransactionContext } from "../database/transaction-context.js";

export interface ValidUserSession {
  readonly id: number;
  readonly userId: number;
  readonly authVersionAtIssue: number;
  readonly authState: string;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
}

export interface UserSessionRepository {
  findValidByTokenHashes(
    tx: TransactionContext,
    tokenHashes: readonly Buffer[],
  ): Promise<ValidUserSession | undefined>;
}

/**
 * 查询仍有效的用户 Session，并实时校验用户启用状态与
 * `auth_version_at_issue = users.auth_version`；停用、撤销、过期、
 * 改密或强制退出的 Session 都按无效处理。
 */
export class PostgresUserSessionRepository implements UserSessionRepository {
  async findValidByTokenHashes(
    tx: TransactionContext,
    tokenHashes: readonly Buffer[],
  ): Promise<ValidUserSession | undefined> {
    if (tokenHashes.length === 0) {
      return undefined;
    }
    const rows = (await tx.sql`
      SELECT us.id,
             us.user_id AS "userId",
             us.auth_version_at_issue AS "authVersionAtIssue",
             us.auth_state AS "authState",
             us.idle_expires_at AS "idleExpiresAt",
             us.absolute_expires_at AS "absoluteExpiresAt"
        FROM app.user_sessions AS us
        JOIN app.users AS u ON u.id = us.user_id
       WHERE us.token_hash IN ${tx.sql(tokenHashes)}
         AND us.revoked_at IS NULL
         AND u.disabled_at IS NULL
         AND u.status = 'ACTIVE'
         AND u.auth_version = us.auth_version_at_issue
         AND us.idle_expires_at > ${new Date()}
         AND us.absolute_expires_at > ${new Date()}
       ORDER BY us.id
       LIMIT 1
       FOR UPDATE OF us
    `) as unknown as readonly ValidUserSession[];
    const row = rows[0];
    return row === undefined ? undefined : { ...row };
  }
}
