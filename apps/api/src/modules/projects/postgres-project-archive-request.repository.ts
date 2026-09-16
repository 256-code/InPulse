import type { TransactionContext } from "../../database/transaction-context.js";
import {
  ProjectArchiveRequestPort,
  type PendingProjectArchiveRequestSummary,
  type ProjectArchiveRequestRecord,
} from "./project-archive-request.port.js";

interface RequestRow {
  readonly id: number;
  readonly project_id: number;
  readonly requested_by: number;
  readonly requested_by_name: string;
  readonly reason: string;
  readonly status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELED";
  readonly requested_at: Date;
  readonly decided_by: number | null;
  readonly decided_by_name: string | null;
  readonly decided_at: Date | null;
  readonly decision_note: string | null;
  readonly row_version: number;
}

interface PendingRow {
  readonly project_id: number;
  readonly id: number;
  readonly requested_by: number;
  readonly requested_by_name: string;
  readonly reason: string;
  readonly requested_at: Date;
}

const toRecord = (row: RequestRow): ProjectArchiveRequestRecord => ({
  requestId: row.id,
  projectId: row.project_id,
  requestedBy: row.requested_by,
  requestedByName: row.requested_by_name,
  reason: row.reason,
  status: row.status,
  requestedAt: new Date(row.requested_at).toISOString(),
  decidedBy: row.decided_by,
  decidedByName: row.decided_by_name,
  decidedAt:
    row.decided_at === null ? null : new Date(row.decided_at).toISOString(),
  decisionNote: row.decision_note,
  rowVersion: row.row_version,
});

/**
 * 项目归档申请 PostgreSQL 适配器；只接收调用方显式 TransactionContext，
 * 从不自行开启事务或使用全局 Drizzle Client。
 */
export class PostgresProjectArchiveRequestRepository extends ProjectArchiveRequestPort {
  async insertRequest(
    tx: TransactionContext,
    input: {
      readonly projectId: number;
      readonly requestedBy: number;
      readonly reason: string;
    },
  ): Promise<ProjectArchiveRequestRecord | undefined> {
    const rows = (await tx.sql`
      INSERT INTO app.project_archive_requests (project_id, requested_by, reason)
      VALUES (${input.projectId}, ${input.requestedBy}, ${input.reason})
      ON CONFLICT DO NOTHING
      RETURNING id
    `) as unknown as readonly { id: number }[];
    const inserted = rows[0];
    if (inserted === undefined) return undefined;
    return this.findRequest(tx, {
      projectId: input.projectId,
      requestId: inserted.id,
    });
  }

  async findRequest(
    tx: TransactionContext,
    input: { readonly projectId: number; readonly requestId: number },
    lock = false,
  ): Promise<ProjectArchiveRequestRecord | undefined> {
    const rows = (await tx.sql`
      SELECT r.id,
             r.project_id,
             r.requested_by,
             requester.name AS requested_by_name,
             r.reason,
             r.status,
             r.requested_at,
             r.decided_by,
             decider.name AS decided_by_name,
             r.decided_at,
             r.decision_note,
             r.row_version
        FROM app.project_archive_requests r
        JOIN app.users requester ON requester.id = r.requested_by
        LEFT JOIN app.users decider ON decider.id = r.decided_by
       WHERE r.project_id = ${input.projectId}
         AND r.id = ${input.requestId}
       ${lock ? tx.sql`FOR UPDATE OF r` : tx.sql``}
    `) as unknown as readonly RequestRow[];
    const row = rows[0];
    return row === undefined ? undefined : toRecord(row);
  }

  async decideRequest(
    tx: TransactionContext,
    input: {
      readonly projectId: number;
      readonly requestId: number;
      readonly status: "APPROVED" | "REJECTED" | "CANCELED";
      readonly decidedBy: number;
      readonly decisionNote: string | null;
      readonly expectedRowVersion: number;
    },
  ): Promise<ProjectArchiveRequestRecord | undefined> {
    const rows = (await tx.sql`
      UPDATE app.project_archive_requests
         SET status = ${input.status},
             decided_by = ${input.decidedBy},
             decided_at = now(),
             decision_note = ${input.decisionNote},
             row_version = row_version + 1
       WHERE id = ${input.requestId}
         AND project_id = ${input.projectId}
         AND status = 'PENDING'
         AND row_version = ${input.expectedRowVersion}
      RETURNING id
    `) as unknown as readonly { id: number }[];
    if (rows.length === 0) return undefined;
    return this.findRequest(tx, {
      projectId: input.projectId,
      requestId: input.requestId,
    });
  }

  async cancelPendingRequests(
    tx: TransactionContext,
    input: { readonly projectId: number; readonly decidedBy: number },
  ): Promise<readonly number[]> {
    const rows = (await tx.sql`
      UPDATE app.project_archive_requests
         SET status = 'CANCELED',
             decided_by = ${input.decidedBy},
             decided_at = now(),
             row_version = row_version + 1
       WHERE project_id = ${input.projectId}
         AND status = 'PENDING'
      RETURNING id
    `) as unknown as readonly { id: number }[];
    return rows.map((row) => row.id);
  }

  async listPendingSummaries(
    tx: TransactionContext,
    projectIds: readonly number[],
  ): Promise<readonly PendingProjectArchiveRequestSummary[]> {
    if (projectIds.length === 0) return [];
    const rows = (await tx.sql`
      SELECT r.project_id,
             r.id,
             r.requested_by,
             requester.name AS requested_by_name,
             r.reason,
             r.requested_at
        FROM app.project_archive_requests r
        JOIN app.users requester ON requester.id = r.requested_by
       WHERE r.status = 'PENDING'
         AND r.project_id = ANY(${projectIds}::integer[])
    `) as unknown as readonly PendingRow[];
    return rows.map((row) => ({
      projectId: row.project_id,
      requestId: row.id,
      requestedBy: row.requested_by,
      requestedByName: row.requested_by_name,
      reason: row.reason,
      requestedAt: new Date(row.requested_at).toISOString(),
    }));
  }

  async listActiveAdminIds(tx: TransactionContext): Promise<readonly number[]> {
    const rows = (await tx.sql`
      SELECT id
        FROM app.users
       WHERE is_admin = true
         AND status = 'ACTIVE'
         AND disabled_at IS NULL
       ORDER BY id ASC
    `) as unknown as readonly { id: number }[];
    return rows.map((row) => row.id);
  }
}
