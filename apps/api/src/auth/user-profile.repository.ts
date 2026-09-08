import type { TransactionContext } from "../database/transaction-context.js";

export interface CurrentUserProfile {
  readonly id: number;
  readonly loginName: string;
  readonly name: string;
  readonly email: string | null;
  readonly avatarUrl: string | null;
  readonly isAdmin: boolean;
  readonly status: "ACTIVE" | "DISABLED";
}

export interface UserProfileRepository {
  findActiveById(
    tx: TransactionContext,
    userId: number,
  ): Promise<CurrentUserProfile | undefined>;
}

/**
 * 当前用户资料查询。只返回仍处于 ACTIVE 状态的用户，避免已停用或已撤销
 * Session 后继续暴露个人信息；查询参数只接受服务端解析出的 userId。
 */
export class PostgresUserProfileRepository implements UserProfileRepository {
  async findActiveById(
    tx: TransactionContext,
    userId: number,
  ): Promise<CurrentUserProfile | undefined> {
    const rows = (await tx.sql`
      SELECT id,
             login_name AS "loginName",
             name,
             email,
             avatar_url AS "avatarUrl",
             is_admin AS "isAdmin",
             status
        FROM app.users
       WHERE id = ${userId}
         AND status = 'ACTIVE'
         AND disabled_at IS NULL
       LIMIT 1
    `) as unknown as readonly CurrentUserProfile[];
    const row = rows[0];
    return row === undefined ? undefined : { ...row };
  }
}
