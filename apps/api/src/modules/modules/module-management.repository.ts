import { Injectable } from "@nestjs/common";
import {
  moduleItemSchema,
  type ModuleEditRequest,
  type ModuleItem,
} from "@inpulse/api-contract";
import type { TransactionContext } from "../../database/transaction-context.js";
import { moduleStatColumns } from "../../stats/card-stat-columns.js";

type Row = Omit<
  ModuleItem,
  "createdAt" | "updatedAt" | "archivedAt" | "stats"
> & {
  createdAt: string | Date;
  updatedAt: string | Date;
  archivedAt: string | Date | null;
  activeFeatureCount: number;
  openTaskCount: number;
};
const dto = (row: Row): ModuleItem => {
  const { activeFeatureCount, openTaskCount, ...rest } = row;
  return moduleItemSchema.parse({
    ...rest,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    archivedAt:
      row.archivedAt === null ? null : new Date(row.archivedAt).toISOString(),
    stats: { activeFeatureCount, openTaskCount },
  });
};

@Injectable()
export class ModuleManagementRepository {
  async list(tx: TransactionContext, projectId: number): Promise<ModuleItem[]> {
    const rows = await tx.sql<
      Row[]
    >`SELECT m.id, m.project_id AS "projectId", m.name, m.description, m.kind, m.status, m.sort_order AS "sortOrder", m.row_version AS "rowVersion", m.created_at AS "createdAt", m.updated_at AS "updatedAt", m.archived_at AS "archivedAt", ${moduleStatColumns(tx.sql, "m")} FROM app.modules m WHERE m.project_id = ${projectId} ORDER BY m.sort_order, m.id`;
    return rows.map(dto);
  }

  async find(
    tx: TransactionContext,
    projectId: number,
    moduleId: number,
    lock = false,
  ): Promise<ModuleItem | undefined> {
    const rows = await tx.sql<
      Row[]
    >`SELECT m.id, m.project_id AS "projectId", m.name, m.description, m.kind, m.status, m.sort_order AS "sortOrder", m.row_version AS "rowVersion", m.created_at AS "createdAt", m.updated_at AS "updatedAt", m.archived_at AS "archivedAt", ${moduleStatColumns(tx.sql, "m")} FROM app.modules m WHERE m.project_id = ${projectId} AND m.id = ${moduleId} ${lock ? tx.sql`FOR UPDATE` : tx.sql``}`;
    return rows[0] === undefined ? undefined : dto(rows[0]);
  }

  async create(
    tx: TransactionContext,
    projectId: number,
    actorId: number,
    input: ModuleEditRequest,
  ): Promise<ModuleItem> {
    const rows = await tx.sql<
      { id: number }[]
    >`INSERT INTO app.modules (project_id, name, description, kind, created_by) VALUES (${projectId}, ${input.name}, ${input.description}, 'NORMAL', ${actorId}) RETURNING id`;
    return (await this.find(tx, projectId, rows[0]!.id))!;
  }

  async update(
    tx: TransactionContext,
    current: ModuleItem,
    next: { name: string; description: string; status: "ACTIVE" | "ARCHIVED" },
  ): Promise<ModuleItem | undefined> {
    const rows = await tx.sql<
      { id: number }[]
    >`UPDATE app.modules SET name = ${next.name}, description = ${next.description}, status = ${next.status}, archived_at = ${next.status === "ARCHIVED" ? tx.sql`now()` : tx.sql`NULL`}, updated_at = now(), row_version = row_version + 1 WHERE id = ${current.id} AND project_id = ${current.projectId} AND row_version = ${current.rowVersion} RETURNING id`;
    return rows.length
      ? this.find(tx, current.projectId, current.id)
      : undefined;
  }
}
