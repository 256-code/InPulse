import type { TransactionContext } from "../database/transaction-context.js";

/** 审计追加结果；recordHash 为对完整 JCS 信封计算的 HMAC-SHA-256。 */
export interface AuditAppendResult {
  readonly chainId: string;
  readonly sequenceNo: number;
  readonly recordHash: Buffer;
}

/** 通用审计写入输入。projectId 为空时写入 SYSTEM 链，否则写 PROJECT:<id> 链。 */
export interface AuditWriteInput {
  readonly projectId: number | null;
  readonly actorType: "USER" | "SYSTEM";
  readonly actorId: number | null;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string | null;
  /** 业务负载；与动作/参与者/请求元数据一起组成 canonical_version 字段集合。 */
  readonly eventPayload: Readonly<Record<string, unknown>>;
  readonly requestId: string;
  readonly clientRequestId?: string | null;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
  readonly occurredAt?: Date;
  /**
   * 密钥轮换：省略时由 keyring 当前版本自动惰性轮换（先在链头锁内以旧
   * 密钥写 `AUDIT_KEY_ROTATED`，再以新密钥写业务事件）；显式指定仅允许
   * action='AUDIT_KEY_ROTATED' 且 eventPayload.newKeyVersion 等于该值。
   */
  readonly nextKeyVersion?: number;
}

export const AUDIT_CANONICAL_VERSION = "JCS-1";

/** 链头锁定后返回的当前状态；由 audit_lock_head 在事务内取 FOR UPDATE。 */
export interface AuditHeadLock {
  readonly chainId: string;
  readonly projectId: number | null;
  readonly lastSequence: number;
  readonly lastHash: Buffer;
  readonly keyVersion: number;
}

/** 审计写入边界（技术设计 §7 / F-08）。 */
export abstract class AuditWritePort {
  abstract append(
    tx: TransactionContext,
    input: AuditWriteInput,
  ): Promise<AuditAppendResult>;
}
