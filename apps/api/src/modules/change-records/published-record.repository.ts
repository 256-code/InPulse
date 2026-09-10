import { Injectable } from "@nestjs/common";
import {
  publishedRecordSchema,
  changeRecordVersionSchema,
  type PublishedRecord,
  type ChangeRecordVersion,
} from "@inpulse/api-contract";
import type { TransactionContext } from "../../database/transaction-context.js";
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
> & {
  title: string;
  currentPayload: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date;
};
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
    return publishedRecordSchema.parse({
      remainingIssues: "",
      ...currentPayload,
      ...identity,
      leftovers,
      leftoverItem: leftoverItem ?? null,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
      publishedAt: new Date(row.publishedAt).toISOString(),
    });
  }
  async find(tx: TransactionContext, projectId: number, recordId: number) {
    const [row] = await tx.sql<
      Row[]
    >`SELECT ${this.columns(tx)} FROM app.change_records WHERE id=${recordId} AND project_id=${projectId} AND status='PUBLISHED'`;
    return row ? this.dto(tx, row) : undefined;
  }
  async list(tx: TransactionContext, projectId: number) {
    const rows = await tx.sql<
      Row[]
    >`SELECT ${this.columns(tx)} FROM app.change_records WHERE project_id=${projectId} AND status='PUBLISHED' ORDER BY published_at DESC,id DESC`;
    return Promise.all(rows.map((row) => this.dto(tx, row)));
  }
  async versions(
    tx: TransactionContext,
    record: PublishedRecord,
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
