import { Inject, Injectable } from "@nestjs/common";
import {
  AUDIT_LOG_PAGE_LIMIT_DEFAULT,
  auditActorTypeSchema,
  type AuditLogItem,
  type AuditLogQueryRequest,
} from "@inpulse/api-contract";

import { AuditReaderDatabase } from "../database/audit-reader.client.js";
import { PostgresUnitOfWork } from "../database/unit-of-work.js";
import { AuditCursorError, AuditCursorService } from "./audit-cursor.js";
import { AuditWritePort } from "./audit.port.js";

/** 原始审计读取动作码（技术设计 7）：每次读取返回前写入 SYSTEM 链。 */
export const AUDIT_LOG_READ_ACTION = "AUDIT_LOG_READ";

/** 查询参数或游标非法 → 422；其他读取/留痕失败由调用方映射为 500。 */
export class AuditQueryValidationError extends Error {
  constructor(
    readonly reason: string,
    message: string,
  ) {
    super(message);
    this.name = "AuditQueryValidationError";
  }
}

export interface AuditQueryInput {
  readonly actorUserId: number;
  readonly query: AuditLogQueryRequest;
}

export interface AuditReadTrailContext {
  readonly requestId: string;
  readonly clientRequestId?: string | null;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
}

export interface AuditQueryResult {
  readonly items: readonly AuditLogItem[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

interface AuditLogRow {
  readonly chain_id: string;
  readonly sequence_no: string;
  readonly project_id: number | null;
  readonly actor_type: string;
  readonly actor_id: number | null;
  readonly action: string;
  readonly target_type: string;
  readonly target_id: string | null;
  readonly event_payload: Record<string, unknown>;
  readonly request_id: string;
  readonly client_request_id: string | null;
  readonly ip_address: string | null;
  readonly user_agent: string | null;
  readonly occurred_at: string;
  readonly prev_hash: Buffer;
  readonly record_hash: Buffer;
  readonly key_version: number;
  readonly canonical_version: string;
}

export function auditChainIdForProject(projectId: number | undefined): string {
  return projectId === undefined ? "SYSTEM" : `PROJECT:${projectId}`;
}

/** 查询条件指纹：链与全部过滤条件的规范化文本，用于游标绑定。 */
function buildQueryFingerprint(
  chainId: string,
  query: AuditLogQueryRequest,
): string {
  return [
    `chain=${chainId}`,
    `action=${query.action ?? ""}`,
    `actor=${query.actorId ?? ""}`,
    `from=${query.from ?? ""}`,
    `to=${query.to ?? ""}`,
  ].join("&");
}

/**
 * F-08 步骤 4：原始审计读取。查询使用独立 `audit_reader` 只读连接，
 * 不占用业务事务；结果只在内存中暂存，返回前必须由 `app_runtime` 在
 * 单独事务内通过受限追加函数向 SYSTEM 链写入 `AUDIT_LOG_READ`
 * （链、过滤条件、返回条数与操作者，不含返回正文）；留痕失败时丢弃
 * 结果并整体失败，绝不把未留痕的审计返回给调用方。
 */
@Injectable()
export class AuditQueryService {
  constructor(
    @Inject(AuditReaderDatabase)
    private readonly reader: AuditReaderDatabase,
    @Inject(AuditCursorService)
    private readonly cursor: AuditCursorService,
    @Inject(AuditWritePort) private readonly audit: AuditWritePort,
    @Inject(PostgresUnitOfWork)
    private readonly unitOfWork: PostgresUnitOfWork,
  ) {}

  async query(
    input: AuditQueryInput,
    trail: AuditReadTrailContext,
  ): Promise<AuditQueryResult> {
    const { actorUserId, query } = input;
    if (
      query.from !== undefined &&
      query.to !== undefined &&
      Date.parse(query.from) >= Date.parse(query.to)
    ) {
      throw new AuditQueryValidationError("invalid-range", "from 必须早于 to");
    }
    const chainId = auditChainIdForProject(query.projectId);
    const limit = query.limit ?? AUDIT_LOG_PAGE_LIMIT_DEFAULT;
    const queryFingerprint = buildQueryFingerprint(chainId, query);

    let afterSequenceNo: number;
    try {
      afterSequenceNo = this.cursor.decode(query.cursor, {
        actorUserId,
        queryFingerprint,
      });
    } catch (error) {
      if (error instanceof AuditCursorError) {
        throw new AuditQueryValidationError("invalid-cursor", error.message);
      }
      throw error;
    }

    const rows = await this.readPage(chainId, query, afterSequenceNo, limit);
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const items: AuditLogItem[] = pageRows.map((row) => ({
      chainId: row.chain_id,
      sequenceNo: Number(row.sequence_no),
      projectId: row.project_id,
      actorType: auditActorTypeSchema.parse(row.actor_type),
      actorId: row.actor_id,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      eventPayload: row.event_payload,
      requestId: row.request_id,
      clientRequestId: row.client_request_id,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      occurredAt: row.occurred_at,
      prevHash: Buffer.from(row.prev_hash).toString("hex"),
      recordHash: Buffer.from(row.record_hash).toString("hex"),
      keyVersion: row.key_version,
      canonicalVersion: row.canonical_version,
    }));
    const last = pageRows[pageRows.length - 1];
    const nextCursor =
      hasMore && last !== undefined
        ? this.cursor.encode({
            actorUserId,
            queryFingerprint,
            afterSequenceNo: Number(last.sequence_no),
          })
        : null;

    await this.unitOfWork.run(async (tx) => {
      await this.audit.append(tx, {
        projectId: null,
        actorType: "USER",
        actorId: actorUserId,
        action: AUDIT_LOG_READ_ACTION,
        targetType: "AUDIT_CHAIN",
        targetId: chainId,
        eventPayload: {
          chainId,
          filters: {
            action: query.action ?? null,
            actorId: query.actorId ?? null,
            from: query.from ?? null,
            to: query.to ?? null,
          },
          returnedCount: items.length,
          hasMore,
        },
        requestId: trail.requestId,
        clientRequestId: trail.clientRequestId ?? null,
        ipAddress: trail.ipAddress ?? null,
        userAgent: trail.userAgent ?? null,
      });
    });

    return { items, nextCursor, hasMore };
  }

  private async readPage(
    chainId: string,
    query: AuditLogQueryRequest,
    afterSequenceNo: number,
    limit: number,
  ): Promise<AuditLogRow[]> {
    const sql = await this.reader.readSql();
    let where = sql`chain_id = ${chainId}`;
    if (query.action !== undefined) {
      where = sql`${where} AND action = ${query.action}`;
    }
    if (query.actorId !== undefined) {
      where = sql`${where} AND actor_id = ${query.actorId}`;
    }
    if (query.from !== undefined) {
      where = sql`${where} AND occurred_at >= ${query.from}::TIMESTAMPTZ`;
    }
    if (query.to !== undefined) {
      where = sql`${where} AND occurred_at < ${query.to}::TIMESTAMPTZ`;
    }
    if (afterSequenceNo > 0) {
      where = sql`${where} AND sequence_no < ${afterSequenceNo}`;
    }
    return (await sql`
      SELECT chain_id,
             sequence_no,
             project_id,
             actor_type,
             actor_id,
             action,
             target_type,
             target_id,
             event_payload,
             request_id,
             client_request_id,
             ip_address::text AS ip_address,
             user_agent,
             to_char(occurred_at AT TIME ZONE 'UTC',
                     'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at,
             prev_hash,
             record_hash,
             key_version,
             canonical_version
        FROM app.audit_logs
       WHERE ${where}
       ORDER BY sequence_no DESC
       LIMIT ${limit + 1}
    `) as unknown as AuditLogRow[];
  }
}
