import { Injectable } from "@nestjs/common";
import {
  moduleItemSchema,
  type ModuleEditRequest,
  type ModuleItem,
} from "@inpulse/api-contract";
import type { TransactionContext } from "../../database/transaction-context.js";

type Row = Omit<ModuleItem, "createdAt" | "updatedAt" | "archivedAt"> & {
  createdAt: string | Date;
  updatedAt: string | Date;
  archivedAt: string | Date | null;
};
const dto = (row: Row): ModuleItem =>
  moduleItemSchema.parse({
    ...row,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    archivedAt:
      row.archivedAt === null ? null : new Date(row.archivedAt).toISOString(),
  });

@Injectable()
export class ModuleManagementRepository {
  async list(tx: TransactionContext, projectId: number): Promise<ModuleItem[]> {
    const rows = await tx.sql<
      Row[]
    >`SELECT id, project_id AS "projectId", name, description, kind, status, sort_order AS "sortOrder", row_version AS "rowVersion", created_at AS "createdAt", updated_at AS "updatedAt", archived_at AS "archivedAt" FROM app.modules WHERE project_id = ${projectId} ORDER BY sort_order, id`;
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
    >`SELECT id, project_id AS "projectId", name, description, kind, status, sort_order AS "sortOrder", row_version AS "rowVersion", created_at AS "createdAt", updated_at AS "updatedAt", archived_at AS "archivedAt" FROM app.modules WHERE project_id = ${projectId} AND id = ${moduleId} ${lock ? tx.sql`FOR UPDATE` : tx.sql``}`;
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
