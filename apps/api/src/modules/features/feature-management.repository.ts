import { Injectable } from "@nestjs/common";
import {
  featureItemSchema,
  type FeatureEditRequest,
  type FeatureItem,
} from "@inpulse/api-contract";
import type { TransactionContext } from "../../database/transaction-context.js";

type Row = Omit<FeatureItem, "createdAt" | "updatedAt" | "archivedAt"> & {
  createdAt: string | Date;
  updatedAt: string | Date;
  archivedAt: string | Date | null;
};
const dto = (row: Row): FeatureItem =>
  featureItemSchema.parse({
    ...row,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    archivedAt:
      row.archivedAt === null ? null : new Date(row.archivedAt).toISOString(),
  });

@Injectable()
export class FeatureManagementRepository {
  async list(
    tx: TransactionContext,
    projectId: number,
    moduleId: number,
  ): Promise<FeatureItem[]> {
    const rows = await tx.sql<
      Row[]
    >`SELECT id, project_id AS "projectId", module_id AS "moduleId", code, name, current_behavior AS "currentBehavior", tags, created_by AS "createdBy", status, row_version AS "rowVersion", created_at AS "createdAt", updated_at AS "updatedAt", archived_at AS "archivedAt" FROM app.features WHERE project_id = ${projectId} AND module_id = ${moduleId} ORDER BY id`;
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
    >`SELECT id, project_id AS "projectId", module_id AS "moduleId", code, name, current_behavior AS "currentBehavior", tags, created_by AS "createdBy", status, row_version AS "rowVersion", created_at AS "createdAt", updated_at AS "updatedAt", archived_at AS "archivedAt" FROM app.features WHERE project_id = ${projectId} AND id = ${featureId} AND module_id = ${moduleId} ${lock ? tx.sql`FOR UPDATE` : tx.sql``}`;
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
    >`INSERT INTO app.features (project_id, module_id, code, name, current_behavior, tags, created_by) VALUES (${projectId}, ${moduleId}, ${code}, ${input.name}, ${input.currentBehavior}, ${tx.sql.array(input.tags)}, ${actorId}) RETURNING id`;
    return (await this.find(tx, projectId, rows[0]!.id, moduleId))!;
  }

  async update(
    tx: TransactionContext,
    current: FeatureItem,
    next: {
      name: string;
      currentBehavior: string;
      tags: string[];
      status: "ACTIVE" | "ARCHIVED";
    },
  ): Promise<FeatureItem | undefined> {
    const rows = await tx.sql<
      { id: number }[]
    >`UPDATE app.features SET name = ${next.name}, current_behavior = ${next.currentBehavior}, tags = ${tx.sql.array(next.tags)}, status = ${next.status}, archived_at = ${next.status === "ARCHIVED" ? tx.sql`now()` : tx.sql`NULL`}, updated_at = now(), row_version = row_version + 1 WHERE id = ${current.id} AND project_id = ${current.projectId} AND row_version = ${current.rowVersion} RETURNING id`;
    return rows.length
      ? this.find(tx, current.projectId, current.id, current.moduleId)
      : undefined;
  }
}
