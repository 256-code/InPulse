import { Injectable } from "@nestjs/common";
import {
  publishedRecordSchema,
  voidedRecordSchema,
  type ReadableRecord,
  changeRecordVersionSchema,
  type PublishedRecord,
  type ChangeRecordVersion,
} from "@inpulse/api-contract";
import type { TransactionContext } from "../../database/transaction-context.js";
import type { TimeCursorValue } from "../../cursors/time-cursor.js";
type Row = Omit<
  PublishedRecord,
  | "createdAt"
  | "updatedAt"
  | "publishedAt"
  | "title"
  | "contextProblem"
  | "changeSolution"
  | "resultVerification"
  | "remainingIssues"
  | "leftovers"
  | "leftoverItem"
  | "status"
> & {
  status: "PUBLISHED" | "VOID";
  title: string;
  currentPayload: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date;
};
export interface RecordListPageInput {
  readonly projectId: number;
  readonly limit: number;
  readonly after: TimeCursorValue | null;
}

export interface RecordListPageResult {
  readonly items: ReadableRecord[];
  readonly last: TimeCursorValue | null;
  readonly hasMore: boolean;
}

@Injectable()
export class PublishedRecordRepository {
  private columns(tx: TransactionContext) {
    return tx.sql`id,project_id AS "projectId",module_id AS "moduleId",feature_id AS "featureId",scope_type AS "scopeType",task_id AS "taskId",title,handler_id AS "handlerId",author_id AS "authorId",status,code,current_version AS "currentVersion",published_at AS "publishedAt",current_payload AS "currentPayload",row_version AS "rowVersion",created_at AS "createdAt",updated_at AS "updatedAt",ARRAY(SELECT feature_id FROM app.change_record_feature_impacts WHERE change_record_id=app.change_records.id ORDER BY feature_id) AS "impactFeatureIds"`;
  }
  private async dto(tx: TransactionContext, row: Row) {
    const { currentPayload, ...identity } = row;
    const leftovers =
      await tx.sql`SELECT l.id,l.status,l.row_version AS "rowVersion",v.content_snapshot AS content FROM app.change_record_version_leftovers v JOIN app.change_record_leftover_items l ON l.id=v.leftover_item_id AND l.project_id=v.project_id AND l.record_id=v.record_id WHERE v.record_id=${row.id} AND v.project_id=${row.projectId} AND v.version_no=${row.currentVersion} ORDER BY l.id`;
    const [leftoverItem] =
      await tx.sql`SELECT l.id,l.status,l.row_version AS "rowVersion",t.task_id AS "linkedTaskId" FROM app.change_record_leftover_items l LEFT JOIN app.leftover_task_links t ON t.leftover_item_id=l.id AND t.project_id=l.project_id WHERE l.record_id=${row.id} AND l.project_id=${row.projectId} ORDER BY l.id`;
    return {
      remainingIssues: "",
      ...currentPayload,
      ...identity,
      leftovers,
      leftoverItem: leftoverItem ?? null,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
      publishedAt: new Date(row.publishedAt).toISOString(),
    };
  }
  async find(tx: TransactionContext, projectId: number, recordId: number) {
    const [row] = await tx.sql<
      Row[]
    >`SELECT ${this.columns(tx)} FROM app.change_records WHERE id=${recordId} AND project_id=${projectId} AND status='PUBLISHED'`;
    return row
      ? publishedRecordSchema.parse(await this.dto(tx, row))
      : undefined;
  }
  async listPublishedPage(
    tx: TransactionContext,
    input: RecordListPageInput,
  ): Promise<RecordListPageResult> {
    const rows = await tx.sql<
      (Row & { publishedAtCursor: string })[]
    >`SELECT ${this.columns(tx)},to_char(published_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "publishedAtCursor" FROM app.change_records WHERE project_id=${input.projectId} AND status='PUBLISHED' AND (${input.after?.at ?? null}::timestamptz IS NULL OR published_at < ${input.after?.at ?? null}::timestamptz OR (published_at = ${input.after?.at ?? null}::timestamptz AND id < ${input.after?.id ?? "0"}::bigint)) ORDER BY published_at DESC,id DESC LIMIT ${input.limit + 1}`;
    const hasMore = rows.length > input.limit,
      pageRows = hasMore ? rows.slice(0, input.limit) : rows;
    const items = await Promise.all(
      pageRows.map(async (row) => {
        const { publishedAtCursor: _cursor, ...base } = row;
        return publishedRecordSchema.parse(await this.dto(tx, base));
      }),
    );
    const lastRow = pageRows[pageRows.length - 1];
    return {
      items,
      hasMore,
      last:
        hasMore && lastRow !== undefined
          ? { at: lastRow.publishedAtCursor, id: String(lastRow.id) }
          : null,
    };
  }
  async findVoided(
    tx: TransactionContext,
    projectId: number,
    recordId: number,
  ) {
    const [row] = await tx.sql<
      (Row & { voidedAt: Date; voidReason: string })[]
    >`SELECT ${this.columns(tx)},voided_at AS "voidedAt",void_reason AS "voidReason" FROM app.change_records WHERE id=${recordId} AND project_id=${projectId} AND status='VOID'`;
    if (!row) return undefined;
    const { voidedAt, voidReason, ...base } = row;
    const content = await this.dto(tx, base);
    return voidedRecordSchema.parse({
      ...content,
      status: "VOID",
      voidedAt: new Date(voidedAt).toISOString(),
      voidReason,
    });
  }
  async listVoidedPage(
    tx: TransactionContext,
    input: RecordListPageInput,
  ): Promise<RecordListPageResult> {
    const rows = await tx.sql<
      (Row & {
        voidedAt: Date;
        voidReason: string;
        publishedAtCursor: string;
      })[]
    >`SELECT ${this.columns(tx)},voided_at AS "voidedAt",void_reason AS "voidReason",to_char(published_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "publishedAtCursor" FROM app.change_records WHERE project_id=${input.projectId} AND status='VOID' AND (${input.after?.at ?? null}::timestamptz IS NULL OR published_at < ${input.after?.at ?? null}::timestamptz OR (published_at = ${input.after?.at ?? null}::timestamptz AND id < ${input.after?.id ?? "0"}::bigint)) ORDER BY published_at DESC,id DESC LIMIT ${input.limit + 1}`;
    const hasMore = rows.length > input.limit,
      pageRows = hasMore ? rows.slice(0, input.limit) : rows;
    const items = await Promise.all(
      pageRows.map(async (row) => {
        const {
          voidedAt,
          voidReason,
          publishedAtCursor: _cursor,
          ...base
        } = row;
        const content = await this.dto(tx, base);
        return voidedRecordSchema.parse({
          ...content,
          status: "VOID",
          voidedAt: new Date(voidedAt).toISOString(),
          voidReason,
        });
      }),
    );
    const lastRow = pageRows[pageRows.length - 1];
    return {
      items,
      hasMore,
      last:
        hasMore && lastRow !== undefined
          ? { at: lastRow.publishedAtCursor, id: String(lastRow.id) }
          : null,
    };
  }
  async versions(
    tx: TransactionContext,
    record: ReadableRecord,
    versionNo?: number,
  ): Promise<ChangeRecordVersion[]> {
    const rows = await tx.sql<
      {
        recordId: number;
        projectId: number;
        versionNo: number;
        title: string;
        payload: Record<string, unknown>;
        createdBy: number;
        createdAt: Date;
      }[]
    >`SELECT record_id AS "recordId",project_id AS "projectId",version_no AS "versionNo",title_snapshot AS title,payload,created_by AS "createdBy",created_at AS "createdAt" FROM app.change_record_versions WHERE record_id=${record.id} AND project_id=${record.projectId} AND version_no<=${record.currentVersion} ${versionNo === undefined ? tx.sql`` : tx.sql`AND version_no=${versionNo}`} ORDER BY version_no DESC`;
    return Promise.all(
      rows.map(async (row) => {
        const { payload, ...identity } = row;
        const leftovers =
          await tx.sql`SELECT leftover_item_id AS id,content_snapshot AS content FROM app.change_record_version_leftovers WHERE record_id=${record.id} AND project_id=${record.projectId} AND version_no=${row.versionNo} ORDER BY leftover_item_id`;
        return changeRecordVersionSchema.parse({
          remainingIssues: "",
          ...payload,
          ...identity,
          leftovers,
          createdAt: new Date(row.createdAt).toISOString(),
        });
      }),
    );
  }
}
