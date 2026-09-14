import { Injectable } from "@nestjs/common";
import {
  featureItemSchema,
  type FeatureEditRequest,
  type FeatureItem,
} from "@inpulse/api-contract";
import type { TransactionContext } from "../../database/transaction-context.js";
import { featureStatColumns } from "../../stats/card-stat-columns.js";

type Row = Omit<
  FeatureItem,
  "createdAt" | "updatedAt" | "archivedAt" | "stats"
> & {
  createdAt: string | Date;
  updatedAt: string | Date;
  archivedAt: string | Date | null;
  openTaskCount: number;
  recordCount: number;
};
const dto = (row: Row): FeatureItem => {
  const { openTaskCount, recordCount, ...rest } = row;
  return featureItemSchema.parse({
    ...rest,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    archivedAt:
      row.archivedAt === null ? null : new Date(row.archivedAt).toISOString(),
    stats: { openTaskCount, recordCount },
  });
};

@Injectable()
export class FeatureManagementRepository {
  async list(
    tx: TransactionContext,
    projectId: number,
    moduleId: number,
  ): Promise<FeatureItem[]> {
    const rows = await tx.sql<
      Row[]
    >`SELECT f.id, f.project_id AS "projectId", f.module_id AS "moduleId", f.code, f.name, f.current_behavior AS "currentBehavior", f.acceptance_criteria AS "acceptanceCriteria", f.tags, f.created_by AS "createdBy", f.status, f.row_version AS "rowVersion", f.created_at AS "createdAt", f.updated_at AS "updatedAt", f.archived_at AS "archivedAt", ${featureStatColumns(tx.sql, "f")} FROM app.features f WHERE f.project_id = ${projectId} AND f.module_id = ${moduleId} ORDER BY f.id`;
    return rows.map(dto);
  }

  async find(
    tx: TransactionContext,
    projectId: number,
    featureId: number,
    moduleId: number,
    lock = false,
  ): Promise<FeatureItem | undefined> {
    const rows = await tx.sql<
      Row[]
    >`SELECT f.id, f.project_id AS "projectId", f.module_id AS "moduleId", f.code, f.name, f.current_behavior AS "currentBehavior", f.acceptance_criteria AS "acceptanceCriteria", f.tags, f.created_by AS "createdBy", f.status, f.row_version AS "rowVersion", f.created_at AS "createdAt", f.updated_at AS "updatedAt", f.archived_at AS "archivedAt", ${featureStatColumns(tx.sql, "f")} FROM app.features f WHERE f.project_id = ${projectId} AND f.id = ${featureId} AND f.module_id = ${moduleId} ${lock ? tx.sql`FOR UPDATE` : tx.sql``}`;
    return rows[0] === undefined ? undefined : dto(rows[0]);
  }

  async candidates(
    tx: TransactionContext,
    projectId: number,
    ids: readonly number[],
  ): Promise<FeatureItem[]> {
    if (!ids.length) return [];
    const rows = await tx.sql<
      { id: number; moduleId: number }[]
    >`SELECT id, module_id AS "moduleId" FROM app.features WHERE project_id = ${projectId} AND id = ANY(${tx.sql.array([...ids])}::int[]) ORDER BY id`;
    return Promise.all(
      rows.map(
        async (row) => (await this.find(tx, projectId, row.id, row.moduleId))!,
      ),
    );
  }

  async create(
    tx: TransactionContext,
    projectId: number,
    actorId: number,
    moduleId: number,
    code: string,
    input: FeatureEditRequest,
  ): Promise<FeatureItem> {
    const rows = await tx.sql<
      { id: number }[]
    >`INSERT INTO app.features (project_id, module_id, code, name, current_behavior, acceptance_criteria, tags, created_by) VALUES (${projectId}, ${moduleId}, ${code}, ${input.name}, ${input.currentBehavior}, ${input.acceptanceCriteria ?? ""}, ${tx.sql.array(input.tags)}, ${actorId}) RETURNING id`;
    return (await this.find(tx, projectId, rows[0]!.id, moduleId))!;
  }

  async update(
    tx: TransactionContext,
    current: FeatureItem,
    next: {
      name: string;
      currentBehavior: string;
      acceptanceCriteria: string;
      tags: string[];
      status: "ACTIVE" | "ARCHIVED";
    },
  ): Promise<FeatureItem | undefined> {
    const rows = await tx.sql<
      { id: number }[]
    >`UPDATE app.features SET name = ${next.name}, current_behavior = ${next.currentBehavior}, acceptance_criteria = ${next.acceptanceCriteria}, tags = ${tx.sql.array(next.tags)}, status = ${next.status}, archived_at = ${next.status === "ARCHIVED" ? tx.sql`now()` : tx.sql`NULL`}, updated_at = now(), row_version = row_version + 1 WHERE id = ${current.id} AND project_id = ${current.projectId} AND row_version = ${current.rowVersion} RETURNING id`;
    return rows.length
      ? this.find(tx, current.projectId, current.id, current.moduleId)
      : undefined;
  }
}
