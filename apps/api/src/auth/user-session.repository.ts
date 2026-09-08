import { and, eq, gt, inArray, isNull } from "drizzle-orm";

import { users, userSessions } from "@inpulse/database";
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
    const rows = await tx.db
      .select({
        id: userSessions.id,
        userId: userSessions.userId,
        authVersionAtIssue: userSessions.authVersionAtIssue,
        authState: userSessions.authState,
        idleExpiresAt: userSessions.idleExpiresAt,
        absoluteExpiresAt: userSessions.absoluteExpiresAt,
      })
      .from(userSessions)
      .innerJoin(users, eq(userSessions.userId, users.id))
      .where(
        and(
          inArray(userSessions.tokenHash, tokenHashes),
          isNull(userSessions.revokedAt),
          isNull(users.disabledAt),
          eq(users.status, "ACTIVE"),
          eq(users.authVersion, userSessions.authVersionAtIssue),
          gt(userSessions.idleExpiresAt, new Date()),
          gt(userSessions.absoluteExpiresAt, new Date()),
        ),
      )
      .for("update", { of: userSessions })
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : { ...row };
  }
}
