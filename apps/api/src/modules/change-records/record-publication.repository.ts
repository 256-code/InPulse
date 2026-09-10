import type { RecordDraftContent } from "@inpulse/api-contract";
import { Injectable } from "@nestjs/common";
import type { TransactionContext } from "../../database/transaction-context.js";
export interface PublicationIdentity {
  id: number;
  projectId: number;
  moduleId: number;
  featureId: number | null;
  taskId: number | null;
  status: string;
  rowVersion: number;
  currentVersion: number;
  impactFeatureIds: number[];
}
@Injectable()
export class RecordPublicationRepository {
  async identity(
    tx: TransactionContext,
    projectId: number,
    recordId: number,
    lock = false,
  ) {
    const [row] = await tx.sql<
      PublicationIdentity[]
    >`SELECT id,project_id AS "projectId",module_id AS "moduleId",feature_id AS "featureId",task_id AS "taskId",status,row_version AS "rowVersion",current_version AS "currentVersion",ARRAY(SELECT feature_id FROM app.change_record_feature_impacts WHERE change_record_id=app.change_records.id ORDER BY feature_id) AS "impactFeatureIds" FROM app.change_records WHERE id=${recordId} AND project_id=${projectId} ${lock ? tx.sql`FOR UPDATE` : tx.sql``}`;
    return row;
  }

  async leftovers(tx: TransactionContext, projectId: number, recordId: number) {
    return tx.sql<
      {
        id: number;
        status: "ACTIVE" | "CONVERTED" | "RESOLVED";
        rowVersion: number;
      }[]
    >`SELECT id,status,row_version AS "rowVersion" FROM app.change_record_leftover_items WHERE project_id=${projectId} AND record_id=${recordId} ORDER BY id FOR UPDATE`;
  }
  async createLeftover(
    tx: TransactionContext,
    projectId: number,
    recordId: number,
    actorId: number,
  ) {
    const [item] = await tx.sql<
      { id: number; status: "ACTIVE"; rowVersion: number }[]
    >`INSERT INTO app.change_record_leftover_items(project_id,record_id,created_by) VALUES(${projectId},${recordId},${actorId}) RETURNING id,status,row_version AS "rowVersion"`;
    return item!;
  }
  async setLeftoverStatus(
    tx: TransactionContext,
    projectId: number,
    recordId: number,
    item: { id: number; rowVersion: number },
    status: "ACTIVE" | "RESOLVED",
  ) {
    const rows =
      await tx.sql`UPDATE app.change_record_leftover_items SET status=${status},row_version=row_version+1,updated_at=GREATEST(clock_timestamp(),updated_at) WHERE id=${item.id} AND project_id=${projectId} AND record_id=${recordId} AND row_version=${item.rowVersion} RETURNING id`;
    return rows.length > 0;
  }
  async writeVersion(
    tx: TransactionContext,
    before: PublicationIdentity,
    actorId: number,
    content: RecordDraftContent,
    code: string,
    leftoverId: number | null,
  ) {
    const next = before.currentVersion + 1,
      { title, ...payload } = content;
    await tx.sql`INSERT INTO app.change_record_versions(record_id,project_id,version_no,title_snapshot,payload,created_by) VALUES(${before.id},${before.projectId},${next},${title},${JSON.stringify(payload)}::jsonb,${actorId})`;
    if (leftoverId !== null)
      await tx.sql`INSERT INTO app.change_record_version_leftovers(record_id,version_no,leftover_item_id,project_id,content_snapshot) VALUES(${before.id},${next},${leftoverId},${before.projectId},${content.remainingIssues})`;
    const rows =
      await tx.sql`UPDATE app.change_records SET title=${title},current_payload=${JSON.stringify(payload)}::jsonb,code=${code},status='PUBLISHED',current_version=${next},published_at=CASE WHEN status='DRAFT' THEN GREATEST(clock_timestamp(),created_at) ELSE published_at END,row_version=row_version+1,updated_at=GREATEST(clock_timestamp(),updated_at) WHERE id=${before.id} AND project_id=${before.projectId} AND row_version=${before.rowVersion} AND current_version=${before.currentVersion} AND status=${before.status} RETURNING id`;
    return rows.length > 0;
  }
}
