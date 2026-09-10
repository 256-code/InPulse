import { Injectable } from "@nestjs/common";
import {
  recordDraftItemSchema,
  type RecordDraftContent,
  type RecordDraftItem,
} from "@inpulse/api-contract";
import type { TransactionContext } from "../../database/transaction-context.js";

export interface DraftScope {
  projectId: number;
  moduleId: number;
  featureId: number | null;
  impactFeatureIds: number[];
}
type Row = {
  id: number;
  projectId: number;
  moduleId: number;
  featureId: number | null;
  scopeType: string;
  taskId: number | null;
  title: string;
  handlerId: number;
  authorId: number;
  status: string;
  code: null;
  currentVersion: number;
  publishedAt: null;
  currentPayload: Record<string, unknown>;
  rowVersion: number;
  createdAt: Date;
  updatedAt: Date;
  impactFeatureIds: number[];
};
const dto = (row: Row) => {
  const { currentPayload, ...fields } = row;
  return recordDraftItemSchema.parse({
    ...currentPayload,
    ...fields,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  });
};
@Injectable()
export class RecordDraftRepository {
  private columns(tx: TransactionContext) {
    return tx.sql`id, project_id AS "projectId",module_id AS "moduleId",feature_id AS "featureId",
    scope_type AS "scopeType",task_id AS "taskId",title,handler_id AS "handlerId",author_id AS "authorId",status,code,
    current_version AS "currentVersion",published_at AS "publishedAt",current_payload AS "currentPayload",
    row_version AS "rowVersion",created_at AS "createdAt",updated_at AS "updatedAt",
    ARRAY(SELECT i.feature_id FROM app.change_record_feature_impacts i WHERE i.change_record_id=app.change_records.id ORDER BY i.feature_id) AS "impactFeatureIds"`;
  }
  async find(
    tx: TransactionContext,
    projectId: number,
    recordId: number,
    lock = false,
  ): Promise<RecordDraftItem | undefined> {
    const [row] = await tx.sql<
      Row[]
    >`SELECT ${this.columns(tx)} FROM app.change_records WHERE project_id=${projectId} AND id=${recordId} AND status='DRAFT' ${lock ? tx.sql`FOR UPDATE` : tx.sql``}`;
    return row ? dto(row) : undefined;
  }
  async list(
    tx: TransactionContext,
    projectId: number,
  ): Promise<RecordDraftItem[]> {
    const rows = await tx.sql<
      Row[]
    >`SELECT ${this.columns(tx)} FROM app.change_records WHERE project_id=${projectId} AND status='DRAFT' ORDER BY id DESC`;
    return rows.map(dto);
  }
  async create(
    tx: TransactionContext,
    scope: DraftScope,
    actorId: number,
    content: RecordDraftContent,
    source?: { taskId: number; handlerId: number },
  ): Promise<RecordDraftItem> {
    const { title, ...payload } = content;
    const [row] = await tx.sql<
      { id: number }[]
    >`INSERT INTO app.change_records(project_id,module_id,feature_id,scope_type,title,handler_id,author_id,status,current_payload,task_id)
      VALUES (${scope.projectId},${scope.moduleId},${scope.featureId},${scope.featureId === null ? "MODULE" : "FEATURE"},${title},${source?.handlerId ?? actorId},${actorId},'DRAFT',${JSON.stringify(payload)}::jsonb,${source?.taskId ?? null}) RETURNING id`;
    for (const featureId of scope.impactFeatureIds)
      await tx.sql`INSERT INTO app.change_record_feature_impacts(change_record_id,module_id,project_id,feature_id) VALUES (${row!.id},${scope.moduleId},${scope.projectId},${featureId})`;
    return (await this.find(tx, scope.projectId, row!.id))!;
  }
  async listForTask(tx: TransactionContext, projectId: number, taskId: number) {
    const rows = await tx.sql<
      Row[]
    >`SELECT ${this.columns(tx)} FROM app.change_records WHERE project_id=${projectId} AND task_id=${taskId} AND status='DRAFT' ORDER BY id DESC`;
    return rows.map(dto);
  }
  async update(
    tx: TransactionContext,
    before: RecordDraftItem,
    content: RecordDraftContent,
  ): Promise<RecordDraftItem | undefined> {
    const { title, ...payload } = content;
    const rows =
      await tx.sql`UPDATE app.change_records SET title=${title},current_payload=${JSON.stringify(payload)}::jsonb,row_version=row_version+1,updated_at=GREATEST(clock_timestamp(),updated_at)
      WHERE id=${before.id} AND project_id=${before.projectId} AND status='DRAFT' AND row_version=${before.rowVersion} RETURNING id`;
    return rows.length ? this.find(tx, before.projectId, before.id) : undefined;
  }
}
