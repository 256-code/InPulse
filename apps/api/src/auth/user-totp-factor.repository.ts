import type { TransactionContext } from "../database/transaction-context.js";

export type TotpFactorStatus = "ENROLLING" | "ACTIVE" | "DISABLED";

export interface TotpFactorLoginSnapshot {
  readonly status: TotpFactorStatus;
  readonly enrollmentGeneration: number;
}

export interface TotpFactorCipher {
  readonly keyVersion: number;
  readonly nonce: Buffer;
  readonly ciphertext: Buffer;
  readonly authTag: Buffer;
}

export interface TotpFactorRecord extends TotpFactorCipher {
  readonly userId: number;
  readonly status: TotpFactorStatus;
  readonly enrollmentGeneration: number;
  readonly lastAcceptedStep: number | null;
  readonly enrolledAt: Date | null;
  readonly disabledAt: Date | null;
  readonly updatedAt: Date;
}

export interface UserTotpFactorRepository {
  findByUserId(
    tx: TransactionContext,
    userId: number,
  ): Promise<TotpFactorStatus | undefined>;
  findLoginSnapshot(
    tx: TransactionContext,
    userId: number,
  ): Promise<TotpFactorLoginSnapshot | undefined>;
  findForUpdate(
    tx: TransactionContext,
    userId: number,
  ): Promise<TotpFactorRecord | undefined>;
  insertPending(
    tx: TransactionContext,
    userId: number,
    generation: number,
    cipher: TotpFactorCipher,
  ): Promise<void>;
  replacePending(
    tx: TransactionContext,
    userId: number,
    expectedGeneration: number,
    generation: number,
    cipher: TotpFactorCipher,
  ): Promise<boolean>;
  activate(
    tx: TransactionContext,
    userId: number,
    expectedGeneration: number,
    acceptedStep: number,
  ): Promise<boolean>;
  acceptStep(
    tx: TransactionContext,
    userId: number,
    expectedLastAcceptedStep: number | null,
    acceptedStep: number,
  ): Promise<boolean>;
  disable(tx: TransactionContext, userId: number): Promise<boolean>;
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

  async findLoginSnapshot(
    tx: TransactionContext,
    userId: number,
  ): Promise<TotpFactorLoginSnapshot | undefined> {
    const rows = (await tx.sql`
      SELECT status,
             enrollment_generation AS "enrollmentGeneration"
        FROM app.user_totp_factors
       WHERE user_id = ${userId}
       LIMIT 1
    `) as unknown as readonly TotpFactorLoginSnapshot[];
    const row = rows[0];
    return row === undefined ? undefined : { ...row };
  }

  async findForUpdate(
    tx: TransactionContext,
    userId: number,
  ): Promise<TotpFactorRecord | undefined> {
    const rows = (await tx.sql`
      SELECT user_id AS "userId",
             status,
             enrollment_generation AS "enrollmentGeneration",
             key_version AS "keyVersion",
             nonce,
             ciphertext,
             auth_tag AS "authTag",
             last_accepted_step::text AS "lastAcceptedStep",
             enrolled_at AS "enrolledAt",
             disabled_at AS "disabledAt",
             updated_at AS "updatedAt"
        FROM app.user_totp_factors
       WHERE user_id = ${userId}
       FOR UPDATE
    `) as unknown as readonly (Omit<
      TotpFactorRecord,
      "lastAcceptedStep" | "enrolledAt" | "disabledAt" | "updatedAt"
    > & {
      readonly lastAcceptedStep: string | null;
      readonly enrolledAt: string | null;
      readonly disabledAt: string | null;
      readonly updatedAt: string;
    })[];
    const row = rows[0];
    return row === undefined
      ? undefined
      : {
          ...row,
          lastAcceptedStep:
            row.lastAcceptedStep === null
              ? null
              : Number.parseInt(row.lastAcceptedStep, 10),
          enrolledAt: row.enrolledAt === null ? null : new Date(row.enrolledAt),
          disabledAt: row.disabledAt === null ? null : new Date(row.disabledAt),
          updatedAt: new Date(row.updatedAt),
        };
  }

  async insertPending(
    tx: TransactionContext,
    userId: number,
    generation: number,
    cipher: TotpFactorCipher,
  ): Promise<void> {
    await tx.sql`
      INSERT INTO app.user_totp_factors (
        user_id,
        status,
        enrollment_generation,
        key_version,
        nonce,
        ciphertext,
        auth_tag,
        last_accepted_step,
        enrolled_at,
        disabled_at,
        created_at,
        updated_at
      )
      VALUES (
        ${userId},
        'ENROLLING',
        ${generation},
        ${cipher.keyVersion},
        ${cipher.nonce},
        ${cipher.ciphertext},
        ${cipher.authTag},
        NULL,
        NULL,
        NULL,
        now(),
        now()
      )
    `;
  }

  async replacePending(
    tx: TransactionContext,
    userId: number,
    expectedGeneration: number,
    generation: number,
    cipher: TotpFactorCipher,
  ): Promise<boolean> {
    const rows = (await tx.sql`
      UPDATE app.user_totp_factors
         SET status = 'ENROLLING',
             enrollment_generation = ${generation},
             key_version = ${cipher.keyVersion},
             nonce = ${cipher.nonce},
             ciphertext = ${cipher.ciphertext},
             auth_tag = ${cipher.authTag},
             last_accepted_step = NULL,
             enrolled_at = NULL,
             disabled_at = NULL,
             updated_at = now()
       WHERE user_id = ${userId}
         AND status IN ('ENROLLING', 'DISABLED')
         AND enrollment_generation = ${expectedGeneration}
      RETURNING user_id AS "userId"
    `) as unknown as readonly { userId: number }[];
    return rows.length > 0;
  }

  async activate(
    tx: TransactionContext,
    userId: number,
    expectedGeneration: number,
    acceptedStep: number,
  ): Promise<boolean> {
    const rows = (await tx.sql`
      UPDATE app.user_totp_factors
         SET status = 'ACTIVE',
             last_accepted_step = ${acceptedStep},
             enrolled_at = now(),
             updated_at = now()
       WHERE user_id = ${userId}
         AND status = 'ENROLLING'
         AND enrollment_generation = ${expectedGeneration}
      RETURNING user_id AS "userId"
    `) as unknown as readonly { userId: number }[];
    return rows.length > 0;
  }

  async acceptStep(
    tx: TransactionContext,
    userId: number,
    expectedLastAcceptedStep: number | null,
    acceptedStep: number,
  ): Promise<boolean> {
    const rows = (await tx.sql`
      UPDATE app.user_totp_factors
         SET last_accepted_step = ${acceptedStep},
             updated_at = now()
       WHERE user_id = ${userId}
         AND status = 'ACTIVE'
         AND last_accepted_step IS NOT DISTINCT FROM ${expectedLastAcceptedStep}
      RETURNING user_id AS "userId"
    `) as unknown as readonly { userId: number }[];
    return rows.length > 0;
  }

  async disable(tx: TransactionContext, userId: number): Promise<boolean> {
    const rows = (await tx.sql`
      UPDATE app.user_totp_factors
         SET status = 'DISABLED',
             disabled_at = now(),
             updated_at = now()
       WHERE user_id = ${userId}
      RETURNING user_id AS "userId"
    `) as unknown as readonly { userId: number }[];
    return rows.length > 0;
  }
}
