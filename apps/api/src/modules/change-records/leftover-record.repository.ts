import { Inject, Injectable } from "@nestjs/common";
import type { TransactionContext } from "../../database/transaction-context.js";
import { PublishedRecordRepository } from "./published-record.repository.js";
import type { PublishedRecord } from "@inpulse/api-contract";
@Injectable()
export class LeftoverRecordRepository {
  constructor(
    @Inject(PublishedRecordRepository)
    private readonly records: PublishedRecordRepository,
  ) {}
  find(tx: TransactionContext, p: number, r: number) {
    return this.records.find(tx, p, r);
  }
  async lock(tx: TransactionContext, p: number, r: number) {
    await tx.sql`SELECT id FROM app.change_records WHERE id=${r} AND project_id=${p} FOR UPDATE`;
    return this.find(tx, p, r);
  }
  async lockItem(tx: TransactionContext, p: number, r: number, item: number) {
    const [row] = await tx.sql<
      {
        id: number;
        status: "ACTIVE" | "CONVERTED" | "RESOLVED";
        rowVersion: number;
        linkedTaskId: number | null;
      }[]
    >`SELECT l.id,l.status,l.row_version AS "rowVersion",t.task_id AS "linkedTaskId" FROM app.change_record_leftover_items l LEFT JOIN app.leftover_task_links t ON t.leftover_item_id=l.id AND t.project_id=l.project_id WHERE l.id=${item} AND l.record_id=${r} AND l.project_id=${p} FOR UPDATE OF l`;
    return row;
  }
  async link(
    tx: TransactionContext,
    record: PublishedRecord,
    item: { id: number; rowVersion: number },
    taskId: number,
    actorId: number,
  ) {
    const links =
      await tx.sql`INSERT INTO app.leftover_task_links(leftover_item_id,task_id,project_id,created_by) VALUES(${item.id},${taskId},${record.projectId},${actorId}) ON CONFLICT(leftover_item_id) DO NOTHING RETURNING task_id`;
    if (!links.length) return false;
    const rows =
      await tx.sql`UPDATE app.change_record_leftover_items SET status='CONVERTED',row_version=row_version+1,updated_at=GREATEST(clock_timestamp(),updated_at) WHERE id=${item.id} AND project_id=${record.projectId} AND record_id=${record.id} AND status='ACTIVE' AND row_version=${item.rowVersion} RETURNING id`;
    if (!rows.length) return false;
    const updated =
      await tx.sql`UPDATE app.change_records SET row_version=row_version+1,updated_at=GREATEST(clock_timestamp(),updated_at) WHERE id=${record.id} AND project_id=${record.projectId} AND status='PUBLISHED' AND row_version=${record.rowVersion} AND current_version=${record.currentVersion} RETURNING id`;
    return updated.length === 1;
  }
  async source(tx: TransactionContext, p: number, taskId: number) {
    const [row] = await tx.sql<
      { projectId: number; recordId: number; leftoverItemId: number }[]
    >`SELECT l.project_id AS "projectId",l.record_id AS "recordId",l.id AS "leftoverItemId" FROM app.leftover_task_links t JOIN app.change_record_leftover_items l ON l.id=t.leftover_item_id AND l.project_id=t.project_id JOIN app.change_records r ON r.id=l.record_id AND r.project_id=l.project_id WHERE t.task_id=${taskId} AND t.project_id=${p} AND r.status='PUBLISHED'`;
    return row ?? null;
  }
}
