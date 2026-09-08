import type { TransactionContext } from "../database/transaction-context.js";

export type TotpFactorStatus = "ENROLLING" | "ACTIVE" | "DISABLED";

export interface UserTotpFactorRepository {
  findByUserId(
    tx: TransactionContext,
    userId: number,
  ): Promise<TotpFactorStatus | undefined>;
}

/**
 * MFA 因子状态查询。管理员登录后必须据此显式选择受限或完整 Session 状态，
 * 不使用数据库默认值；查询在用户 `FOR SHARE` 锁之后执行。
 */
export class PostgresUserTotpFactorRepository implements UserTotpFactorRepository {
  async findByUserId(
    tx: TransactionContext,
    userId: number,
  ): Promise<TotpFactorStatus | undefined> {
    const rows = (await tx.sql`
      SELECT status
        FROM app.user_totp_factors
       WHERE user_id = ${userId}
       LIMIT 1
    `) as unknown as readonly { status: TotpFactorStatus }[];
    return rows[0]?.status;
  }
}
