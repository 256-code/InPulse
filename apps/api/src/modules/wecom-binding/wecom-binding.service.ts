import { createHash, randomBytes } from "node:crypto";

import type { Sql } from "postgres";

import type { TransactionContext } from "../../database/transaction-context.js";

/** Crockford Base32（去除易混字符 I / L / O / U）；16 字符 × 5 bit = 80 bit 熵。 */
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 绑定码有效期：10 分钟（ADR-069）。 */
export const WECOM_BINDING_CODE_TTL_MS = 10 * 60 * 1000;

const CODE_TTL_SECONDS = Math.floor(WECOM_BINDING_CODE_TTL_MS / 1000);

export interface WecomBindingStatusRecord {
  readonly state: "UNBOUND" | "PENDING" | "BOUND";
  readonly boundAt: string | null;
  readonly codeExpiresAt: string | null;
}

export interface WecomBindingCodeRecord {
  readonly code: string;
  readonly expiresAt: string;
}

/** 生成 4 组 4 位的绑定码；明文只返回一次，服务端只存 SHA-256 Hash。 */
export function generateWecomBindingCode(): string {
  const bytes = randomBytes(10);
  let packed = 0n;
  for (const byte of bytes) {
    packed = (packed << 8n) | BigInt(byte);
  }
  let raw = "";
  for (let index = 0; index < 16; index += 1) {
    const shift = BigInt((15 - index) * 5);
    raw += CODE_ALPHABET.charAt(Number((packed >> shift) & 31n));
  }
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
}

/**
 * 绑定码规范化与哈希：大写、去除连字符与空白后做 SHA-256。
 * 与长连接桥接侧使用完全相同的规则；码为 80 bit 随机值、10 分钟有效
 * 且一次性消费（兑换在 app.redeem_wecom_binding_code 内完成）。
 */
export function hashWecomBindingCode(code: string): Buffer {
  const normalized = code
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "");
  return createHash("sha256").update(normalized, "utf8").digest();
}

/**
 * ADR-069 企微绑定状态服务：状态读取用非事务连接；写操作必须显式接收
 * 同一个 TransactionContext；解绑的锁序与兑换函数一致（先码后绑定），
 * 避免与 app.redeem_wecom_binding_code 并发时互相持有行锁形成死锁。
 */
export class WecomBindingStateService {
  readonly #sql: Sql;

  constructor(sql: Sql) {
    this.#sql = sql;
  }

  async status(userId: number): Promise<WecomBindingStatusRecord> {
    const rows = (await this.#sql`
      SELECT
        (
          SELECT to_char(
                   b.bound_at AT TIME ZONE 'UTC',
                   'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
                 )
            FROM app.user_wecom_bindings AS b
           WHERE b.user_id = ${userId}
             AND b.status = 'ACTIVE'
           LIMIT 1
        ) AS bound_at,
        (
          SELECT to_char(
                   c.expires_at AT TIME ZONE 'UTC',
                   'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
                 )
            FROM app.wecom_binding_codes AS c
           WHERE c.user_id = ${userId}
             AND c.consumed_at IS NULL
             AND c.expires_at > now()
           LIMIT 1
        ) AS code_expires_at
    `) as unknown as readonly {
      bound_at: string | null;
      code_expires_at: string | null;
    }[];
    const row = rows[0];
    const boundAt = row?.bound_at ?? null;
    const codeExpiresAt = row?.code_expires_at ?? null;
    return {
      state:
        boundAt !== null
          ? "BOUND"
          : codeExpiresAt !== null
            ? "PENDING"
            : "UNBOUND",
      boundAt,
      codeExpiresAt,
    };
  }

  async createCode(
    tx: TransactionContext,
    userId: number,
  ): Promise<WecomBindingCodeRecord> {
    const code = generateWecomBindingCode();
    const codeHash = hashWecomBindingCode(code);
    const rows = await tx.sql`
      INSERT INTO app.wecom_binding_codes AS c
        (user_id, code_hash, expires_at, consumed_at, consumed_by_wecom_userid)
      VALUES
        (
          ${userId},
          ${codeHash},
          now() + make_interval(secs => ${CODE_TTL_SECONDS}),
          NULL,
          NULL
        )
      ON CONFLICT (user_id) DO UPDATE
         SET code_hash = EXCLUDED.code_hash,
             expires_at = EXCLUDED.expires_at,
             consumed_at = NULL,
             consumed_by_wecom_userid = NULL,
             created_at = now()
      RETURNING to_char(
                 c.expires_at AT TIME ZONE 'UTC',
                 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
               ) AS expires_at
    `;
    const row = (rows as unknown as readonly { expires_at: string }[])[0];
    if (row === undefined) {
      throw new Error("wecom binding code upsert returned no row");
    }
    return { code, expiresAt: row.expires_at };
  }

  async revoke(tx: TransactionContext, userId: number): Promise<void> {
    await tx.sql`
      UPDATE app.wecom_binding_codes
         SET consumed_at = now(),
             consumed_by_wecom_userid = NULL
       WHERE user_id = ${userId}
         AND consumed_at IS NULL
    `;
    await tx.sql`
      UPDATE app.user_wecom_bindings
         SET status = 'REVOKED',
             revoked_at = now(),
             updated_at = now(),
             row_version = row_version + 1
       WHERE user_id = ${userId}
         AND status = 'ACTIVE'
    `;
  }
}
