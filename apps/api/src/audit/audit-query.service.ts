import { Inject, Injectable } from "@nestjs/common";
import {
  AUDIT_LOG_PAGE_LIMIT_DEFAULT,
  auditActorTypeSchema,
  type AuditLogItem,
  type AuditLogQueryRequest,
} from "@inpulse/api-contract";

import { AuditReaderDatabase } from "../database/audit-reader.client.js";
import {
  AuditCursorError,
  AuditCursorService,
  type AuditCursorPosition,
} from "./audit-cursor.js";

/** 查询参数或游标非法 → 422；其他读取失败由调用方映射为 500。 */
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
    `actor=${query.actorIds?.join(",") ?? ""}`,
    `from=${query.from ?? ""}`,
    `to=${query.to ?? ""}`,
  ].join("&");
}

/**
 * F-08 步骤 4：原始审计读取。查询使用独立 `audit_reader` 只读连接，
 * 不占用业务事务、不写任何审计（读取留痕已由 ADR-060 移除）；
 * 结果直接返回，游标由服务端签名并绑定操作者与查询指纹。
 */
@Injectable()
export class AuditQueryService {
  constructor(
    @Inject(AuditReaderDatabase)
    private readonly reader: AuditReaderDatabase,
    @Inject(AuditCursorService)
    private readonly cursor: AuditCursorService,
  ) {}

  async query(input: AuditQueryInput): Promise<AuditQueryResult> {
    const { actorUserId, query } = input;
    if (
      query.from !== undefined &&
      query.to !== undefined &&
      Date.parse(query.from) >= Date.parse(query.to)
    ) {
      throw new AuditQueryValidationError("invalid-range", "from 必须早于 to");
    }
    if (query.chain === "all" && query.projectId !== undefined) {
      throw new AuditQueryValidationError(
        "invalid-chain",
        "chain=all 与 projectId 不能同时使用",
      );
    }
    // chain=all（ADR-061）读全部链；否则按 projectId 选单链（缺省 SYSTEM）。
    const allChains = query.chain === "all";
    const chainId = allChains ? null : auditChainIdForProject(query.projectId);
    const limit = query.limit ?? AUDIT_LOG_PAGE_LIMIT_DEFAULT;
    // 跨链用固定标识入指纹，保证游标不能跨读取模式或跨链复用。
    const queryFingerprint = buildQueryFingerprint(chainId ?? "ALL", query);

    let position: AuditCursorPosition | null;
    try {
      position = this.cursor.decode(query.cursor, {
        actorUserId,
        queryFingerprint,
      });
    } catch (error) {
      if (error instanceof AuditCursorError) {
        throw new AuditQueryValidationError("invalid-cursor", error.message);
      }
      throw error;
    }

    const rows = await this.readPage(chainId, query, position, limit);
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
            ...(allChains
              ? {
                  afterChainId: last.chain_id,
                  afterOccurredAt: last.occurred_at,
                }
              : {}),
          })
        : null;

    return { items, nextCursor, hasMore };
  }

  /**
   * 单链按链序号倒序分页；`chainId === null`（chain=all，ADR-061）改为跨链
   * 按 (occurred_at, chain_id, sequence_no) 倒序并做复合键集分页——各链的
   * sequence_no 互相独立，单序号无法跨链定位。两种模式共用过滤条件与列清单。
   */
  private async readPage(
    chainId: string | null,
    query: AuditLogQueryRequest,
    position: AuditCursorPosition | null,
    limit: number,
  ): Promise<AuditLogRow[]> {
    const sql = await this.reader.readSql();
    let where = chainId === null ? sql`TRUE` : sql`chain_id = ${chainId}`;
    if (query.action !== undefined) {
      where = sql`${where} AND action = ${query.action}`;
    }
    if (query.actorIds !== undefined) {
      where = sql`${where} AND actor_id = ANY(${query.actorIds}::integer[])`;
    }
    if (query.from !== undefined) {
      where = sql`${where} AND occurred_at >= ${query.from}::TIMESTAMPTZ`;
    }
    if (query.to !== undefined) {
      where = sql`${where} AND occurred_at < ${query.to}::TIMESTAMPTZ`;
    }

    let orderBy = sql`sequence_no DESC`;
    if (chainId === null) {
      orderBy = sql`occurred_at DESC, chain_id DESC, sequence_no DESC`;
      if (position !== null) {
        if (
          position.chainId === undefined ||
          position.occurredAt === undefined
        ) {
          throw new AuditQueryValidationError(
            "invalid-cursor",
            "跨链分页游标缺少链坐标",
          );
        }
        where = sql`${where} AND (
          occurred_at < ${position.occurredAt}::TIMESTAMPTZ
          OR (occurred_at = ${position.occurredAt}::TIMESTAMPTZ
              AND chain_id < ${position.chainId})
          OR (occurred_at = ${position.occurredAt}::TIMESTAMPTZ
              AND chain_id = ${position.chainId}
              AND sequence_no < ${position.sequenceNo})
        )`;
      }
    } else if (position !== null) {
      where = sql`${where} AND sequence_no < ${position.sequenceNo}`;
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
       ORDER BY ${orderBy}
       LIMIT ${limit + 1}
    `) as unknown as AuditLogRow[];
  }
}
