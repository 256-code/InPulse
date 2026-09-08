import { and, eq } from "drizzle-orm";

import { idempotencyRecords } from "@inpulse/database";
import type { TransactionContext } from "../database/transaction-context.js";

export type IdempotencyState = "PENDING" | "SUCCEEDED";

/** 幂等记录的领域模型（对应 `app.idempotency_records`）。 */
export interface IdempotencyRecord {
  readonly id: number;
  readonly actorId: number;
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly idempotencyContractVersion: string;
  readonly requestHash: Buffer;
  readonly requestHashKeyVersion: number;
  readonly state: IdempotencyState;
  readonly responseStatus: number | null;
  readonly responseSchemaRef: string | null;
  readonly replayPolicyVersion: string | null;
  readonly replayAuthPolicyVersion: string | null;
  readonly replayAuthContext: Record<string, unknown> | null;
  readonly responseHasBody: boolean | null;
  readonly responseBody: unknown | null;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export interface IdempotencyRecordInsert {
  readonly actorId: number;
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly idempotencyContractVersion: string;
  readonly requestHash: Buffer;
  readonly requestHashKeyVersion: number;
  readonly expiresAt: Date;
}

export interface IdempotencySuccess {
  readonly responseStatus: number;
  readonly responseSchemaRef: string | null;
  readonly replayPolicyVersion: string;
  readonly replayAuthPolicyVersion: string;
  readonly replayAuthContext: Record<string, unknown>;
  readonly responseHasBody: boolean;
  readonly responseBody: unknown | null;
}

export interface IdempotencyStore {
  insertPending(
    tx: TransactionContext,
    insert: IdempotencyRecordInsert,
  ): Promise<IdempotencyRecord | undefined>;
  find(
    tx: TransactionContext,
    actorId: number,
    operationId: string,
    idempotencyKey: string,
  ): Promise<IdempotencyRecord | undefined>;
  markSucceeded(
    tx: TransactionContext,
    actorId: number,
    operationId: string,
    idempotencyKey: string,
    success: IdempotencySuccess,
  ): Promise<IdempotencyRecord | undefined>;
}

/** 把 64 位十六进制摘要转成数据库要求的 32 字节 `bytea`。 */
export function hexDigestToRequestHash(hex: string): Buffer {
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error("request hash must be a 64-character lowercase hex string");
  }
  const buffer = Buffer.from(hex, "hex");
  if (buffer.length !== 32) {
    throw new Error("request hash must decode to exactly 32 bytes");
  }
  return buffer;
}

/** 与 0002 的 `expires_at <= created_at + 30 days` 保持一致的过期时间。 */
export function defaultIdempotencyExpiry(now: Date): Date {
  return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
}

/**
 * 判断已存在记录是否为可重放的同一请求：
 * requestHash、幂等契约版本与 HMAC 密钥版本必须完全一致。
 */
export function isReplayMatch(
  existing: Pick<
    IdempotencyRecord,
    "requestHash" | "idempotencyContractVersion" | "requestHashKeyVersion"
  >,
  current: {
    readonly requestHash: Buffer;
    readonly idempotencyContractVersion: string;
    readonly requestHashKeyVersion: number;
  },
): boolean {
  return (
    Buffer.compare(existing.requestHash, current.requestHash) === 0 &&
    existing.idempotencyContractVersion ===
      current.idempotencyContractVersion &&
    existing.requestHashKeyVersion === current.requestHashKeyVersion
  );
}

/** 写入前校验 2xx 成功响应与 `idempotency_records_response_check` 一致。 */
export function validateSuccessResponse(success: IdempotencySuccess): void {
  if (success.responseStatus < 200 || success.responseStatus > 299) {
    throw new Error("idempotency replay response status must be a 2xx");
  }
  if (!success.replayPolicyVersion) {
    throw new Error("replayPolicyVersion is required for a succeeded record");
  }
  if (!success.replayAuthPolicyVersion) {
    throw new Error(
      "replayAuthPolicyVersion is required for a succeeded record",
    );
  }
  if (
    success.replayAuthContext === null ||
    typeof success.replayAuthContext !== "object"
  ) {
    throw new Error("replayAuthContext must be a JSON object");
  }
  if (success.responseHasBody) {
    if (!success.responseSchemaRef) {
      throw new Error(
        "responseSchemaRef is required when responseHasBody is true",
      );
    }
    if (success.responseBody === null) {
      throw new Error("responseBody is required when responseHasBody is true");
    }
  } else if (
    success.responseSchemaRef !== null ||
    success.responseBody !== null
  ) {
    throw new Error(
      "response schema/body must be null when responseHasBody is false",
    );
  }
}

type IdempotencyRow = typeof idempotencyRecords.$inferSelect;

function mapRecord(row: IdempotencyRow): IdempotencyRecord {
  return {
    id: row.id,
    actorId: row.actorId,
    operationId: row.operationId,
    idempotencyKey: row.idempotencyKey,
    idempotencyContractVersion: row.idempotencyContractVersion,
    requestHash: row.requestHash,
    requestHashKeyVersion: row.requestHashKeyVersion,
    state: row.state as IdempotencyState,
    responseStatus: row.responseStatus,
    responseSchemaRef: row.responseSchemaRef,
    replayPolicyVersion: row.replayPolicyVersion,
    replayAuthPolicyVersion: row.replayAuthPolicyVersion,
    replayAuthContext:
      (row.replayAuthContext as Record<string, unknown>) ?? null,
    responseHasBody: row.responseHasBody,
    responseBody: row.responseBody ?? null,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}

/**
 * 基于 `app.idempotency_records` 的 Postgres 幂等存储。
 *
 * 所有方法都接收显式 `TransactionContext`，使用事务绑定的 `tx.db`（Drizzle），
 * 不创建自己的 `UnitOfWork`，也不使用全局 Drizzle Client；
 * 调用方必须把幂等记录写入与业务写入放在同一个事务里。
 */
export class PostgresIdempotencyStore implements IdempotencyStore {
  async insertPending(
    tx: TransactionContext,
    insert: IdempotencyRecordInsert,
  ): Promise<IdempotencyRecord | undefined> {
    const rows = await tx.db
      .insert(idempotencyRecords)
      .values({
        actorId: insert.actorId,
        operationId: insert.operationId,
        idempotencyKey: insert.idempotencyKey,
        idempotencyContractVersion: insert.idempotencyContractVersion,
        requestHash: insert.requestHash,
        requestHashKeyVersion: insert.requestHashKeyVersion,
        expiresAt: insert.expiresAt,
      })
      .onConflictDoNothing({
        target: [
          idempotencyRecords.actorId,
          idempotencyRecords.operationId,
          idempotencyRecords.idempotencyKey,
        ],
      })
      .returning();
    const row = rows[0];
    return row === undefined ? undefined : mapRecord(row);
  }

  async find(
    tx: TransactionContext,
    actorId: number,
    operationId: string,
    idempotencyKey: string,
  ): Promise<IdempotencyRecord | undefined> {
    const rows = await tx.db
      .select()
      .from(idempotencyRecords)
      .where(
        and(
          eq(idempotencyRecords.actorId, actorId),
          eq(idempotencyRecords.operationId, operationId),
          eq(idempotencyRecords.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : mapRecord(row);
  }

  async markSucceeded(
    tx: TransactionContext,
    actorId: number,
    operationId: string,
    idempotencyKey: string,
    success: IdempotencySuccess,
  ): Promise<IdempotencyRecord | undefined> {
    validateSuccessResponse(success);
    const rows = await tx.db
      .update(idempotencyRecords)
      .set({
        state: "SUCCEEDED",
        responseStatus: success.responseStatus,
        responseSchemaRef: success.responseSchemaRef,
        replayPolicyVersion: success.replayPolicyVersion,
        replayAuthPolicyVersion: success.replayAuthPolicyVersion,
        replayAuthContext: success.replayAuthContext,
        responseHasBody: success.responseHasBody,
        responseBody: success.responseBody,
      })
      .where(
        and(
          eq(idempotencyRecords.actorId, actorId),
          eq(idempotencyRecords.operationId, operationId),
          eq(idempotencyRecords.idempotencyKey, idempotencyKey),
          eq(idempotencyRecords.state, "PENDING"),
        ),
      )
      .returning();
    const row = rows[0];
    return row === undefined ? undefined : mapRecord(row);
  }
}
