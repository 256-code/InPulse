import type { DatabaseClient } from "@inpulse/database/client";

import type { AuditChainHead } from "./checkpoint.js";
import {
  buildCheckpointEnvelope,
  encodeCheckpointEnvelope,
} from "./checkpoint.js";
import type { OpsConfig } from "./config.js";
import {
  buildAuditExportManifest,
  buildAuditExportPackage,
  encodeAuditExportManifest,
  type AuditExportRow,
  type AuditExportWindow,
} from "./export.js";
import { connectArchiveDatabase } from "./db.js";
import { WormClient, type WormPutResult } from "./worm.js";

type ArchiveSql = DatabaseClient["sql"];

export interface ArchiveDependencies {
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface CheckpointRunSummary {
  readonly mode: "checkpoint";
  readonly chainCount: number;
  readonly objects: readonly WormPutResult[];
}

export interface ExportRunSummary {
  readonly mode: "export";
  readonly windowFrom: string;
  readonly windowTo: string;
  readonly rowCount: number;
  readonly packageObjectKey: string;
  readonly manifestObjectKey: string;
  readonly objects: readonly WormPutResult[];
}

const READ_BATCH_SIZE = 1000;

function resolveNow(deps: ArchiveDependencies): Date {
  return deps.now?.() ?? new Date();
}

function makeWorm(config: OpsConfig, deps: ArchiveDependencies): WormClient {
  return new WormClient(config.worm, {
    ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
    ...(deps.sleep === undefined ? {} : { sleep: deps.sleep }),
    ...(deps.now === undefined ? {} : { now: deps.now }),
    timeoutMs: config.fetchTimeoutMs,
  });
}

function chainSlug(chainId: string): string {
  return chainId.replace(/[^A-Za-z0-9._-]+/g, "-");
}

function compactTimestamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

export function checkpointObjectKey(
  prefix: string,
  chainId: string,
  generatedAt: Date,
  lastSequenceNo: number,
): string {
  return `${prefix}/checkpoints/chain=${chainSlug(chainId)}/${compactTimestamp(
    generatedAt,
  )}-seq${lastSequenceNo}.json`;
}

export function exportObjectKey(
  prefix: string,
  window: AuditExportWindow,
): string {
  const date = window.from.toISOString().slice(0, 10);
  return `${prefix}/exports/date=${date}/audit-export-${compactTimestamp(
    window.from,
  )}-${compactTimestamp(window.to)}.jsonl.enc`;
}

/** 默认导出窗口：前一个 UTC 自然日 [00:00, 24:00)。 */
export function previousUtcDay(now: Date): AuditExportWindow {
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const start = new Date(end.getTime() - 86_400_000);
  return { from: start, to: end };
}

export async function readChainHeads(
  sql: ArchiveSql,
): Promise<AuditChainHead[]> {
  const rows = (await sql`
    SELECT chain_id AS "chainId",
           project_id AS "projectId",
           last_sequence AS "lastSequence",
           encode(last_hash, 'hex') AS "lastHash",
           key_version AS "keyVersion",
           to_char(
             updated_at AT TIME ZONE 'UTC',
             'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
           ) AS "headUpdatedAt"
      FROM app.audit_chain_heads
     ORDER BY chain_id
  `) as unknown as readonly {
    readonly chainId: string;
    readonly projectId: number | null;
    readonly lastSequence: string;
    readonly lastHash: string;
    readonly keyVersion: number;
    readonly headUpdatedAt: string;
  }[];
  return rows.map((row) => ({
    chainId: row.chainId,
    projectId: row.projectId,
    lastSequenceNo: Number(row.lastSequence),
    lastHash: row.lastHash,
    keyVersion: row.keyVersion,
    headUpdatedAt: row.headUpdatedAt,
  }));
}

interface AuditLogRow {
  readonly chainId: string;
  readonly sequenceNo: string;
  readonly projectId: number | null;
  readonly actorType: string;
  readonly actorId: number | null;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly eventPayload: Record<string, unknown>;
  readonly requestId: string;
  readonly clientRequestId: string | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly occurredAt: string;
  readonly prevHash: string;
  readonly recordHash: string;
  readonly keyVersion: number;
  readonly canonicalVersion: string;
}

function mapAuditRow(row: AuditLogRow): AuditExportRow {
  return {
    chainId: row.chainId,
    sequenceNo: Number(row.sequenceNo),
    projectId: row.projectId,
    actorType: row.actorType,
    actorId: row.actorId,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    eventPayload: row.eventPayload,
    requestId: row.requestId,
    clientRequestId: row.clientRequestId,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    occurredAt: row.occurredAt,
    prevHash: row.prevHash,
    recordHash: row.recordHash,
    keyVersion: row.keyVersion,
    canonicalVersion: row.canonicalVersion,
  };
}

const AUDIT_ROW_COLUMNS = `chain_id AS "chainId",
           sequence_no::text AS "sequenceNo",
           project_id AS "projectId",
           actor_type AS "actorType",
           actor_id AS "actorId",
           action,
           target_type AS "targetType",
           target_id AS "targetId",
           event_payload AS "eventPayload",
           request_id AS "requestId",
           client_request_id AS "clientRequestId",
           ip_address::text AS "ipAddress",
           user_agent AS "userAgent",
           to_char(
             occurred_at AT TIME ZONE 'UTC',
             'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
           ) AS "occurredAt",
           encode(prev_hash, 'hex') AS "prevHash",
           encode(record_hash, 'hex') AS "recordHash",
           key_version AS "keyVersion",
           canonical_version AS "canonicalVersion"`;

/** 按 (occurred_at, chain_id, sequence_no) 键集分页读取窗口内全部审计行。 */
export async function readAuditRows(
  sql: ArchiveSql,
  window: AuditExportWindow,
): Promise<AuditExportRow[]> {
  const rows: AuditExportRow[] = [];
  let cursor:
    | {
        readonly occurredAt: string;
        readonly chainId: string;
        readonly sequenceNo: number;
      }
    | undefined;
  for (;;) {
    const batch = (cursor === undefined
      ? await sql`
            SELECT ${sql.unsafe(AUDIT_ROW_COLUMNS)}
              FROM app.audit_logs
             WHERE occurred_at >= ${window.from.toISOString()}::timestamptz
               AND occurred_at < ${window.to.toISOString()}::timestamptz
             ORDER BY occurred_at, chain_id, sequence_no
             LIMIT ${READ_BATCH_SIZE}
          `
      : await sql`
            SELECT ${sql.unsafe(AUDIT_ROW_COLUMNS)}
              FROM app.audit_logs
             WHERE occurred_at >= ${window.from.toISOString()}::timestamptz
               AND occurred_at < ${window.to.toISOString()}::timestamptz
               AND (occurred_at, chain_id, sequence_no) > (
                 ${cursor.occurredAt}::timestamptz,
                 ${cursor.chainId}::text,
                 ${cursor.sequenceNo}::bigint
               )
             ORDER BY occurred_at, chain_id, sequence_no
             LIMIT ${READ_BATCH_SIZE}
          `) as unknown as readonly AuditLogRow[];
    for (const row of batch) {
      rows.push(mapAuditRow(row));
    }
    if (batch.length < READ_BATCH_SIZE) {
      break;
    }
    const last = batch[batch.length - 1];
    if (last === undefined) {
      break;
    }
    cursor = {
      occurredAt: last.occurredAt,
      chainId: last.chainId,
      sequenceNo: Number(last.sequenceNo),
    };
  }
  return rows;
}

/** 每小时任务：为每条审计链写一个签名链头检查点到 WORM。 */
export async function runCheckpoint(
  config: OpsConfig,
  deps: ArchiveDependencies = {},
): Promise<CheckpointRunSummary> {
  const generatedAt = resolveNow(deps);
  const worm = makeWorm(config, deps);
  const client = connectArchiveDatabase(config.databaseUrl);
  try {
    const heads = await readChainHeads(client.sql);
    const objects: WormPutResult[] = [];
    for (const head of heads) {
      const envelope = buildCheckpointEnvelope(
        head,
        generatedAt,
        config.signingKeyring,
      );
      const body = encodeCheckpointEnvelope(envelope);
      objects.push(
        await worm.putObject(
          checkpointObjectKey(
            config.worm.prefix,
            head.chainId,
            generatedAt,
            head.lastSequenceNo,
          ),
          body,
          "application/json",
        ),
      );
    }
    return { mode: "checkpoint", chainCount: heads.length, objects };
  } finally {
    await client.close();
  }
}

/** 每日任务：导出窗口内全部审计明细（加密 + 清单签名）到独立 WORM 前缀。 */
export async function runExport(
  config: OpsConfig,
  deps: ArchiveDependencies = {},
  window?: AuditExportWindow,
): Promise<ExportRunSummary> {
  const generatedAt = resolveNow(deps);
  const effectiveWindow = window ?? previousUtcDay(generatedAt);
  const worm = makeWorm(config, deps);
  const client = connectArchiveDatabase(config.databaseUrl);
  try {
    const rows = await readAuditRows(client.sql, effectiveWindow);
    const built = buildAuditExportPackage(
      rows,
      effectiveWindow,
      config.signingKeyring,
    );
    const packageKey = exportObjectKey(config.worm.prefix, effectiveWindow);
    const manifest = buildAuditExportManifest(
      built.header,
      built.ciphertext,
      packageKey,
      generatedAt,
      config.signingKeyring,
    );
    const manifestKey = `${packageKey}.manifest.json`;
    const objects: WormPutResult[] = [];
    objects.push(
      await worm.putObject(packageKey, built.file, "application/octet-stream"),
    );
    objects.push(
      await worm.putObject(
        manifestKey,
        encodeAuditExportManifest(manifest),
        "application/json",
      ),
    );
    return {
      mode: "export",
      windowFrom: built.header.windowFrom,
      windowTo: built.header.windowTo,
      rowCount: built.header.rowCount,
      packageObjectKey: packageKey,
      manifestObjectKey: manifestKey,
      objects,
    };
  } finally {
    await client.close();
  }
}
