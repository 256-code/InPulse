import type { TransactionContext } from "../../database/transaction-context.js";
import {
  ModuleReadPort,
  type ModuleCountInput,
  type ModuleNameItem,
  type ModuleNameLookupInput,
  type ModuleNameMatchItem,
  type ModuleReadResource,
} from "./module-read.port.js";

export class PostgresModuleReadPort extends ModuleReadPort {
  async find(
    tx: TransactionContext,
    projectId: number,
    moduleId: number,
  ): Promise<ModuleReadResource | undefined> {
    const [row] = await tx.sql<
      ModuleReadResource[]
    >`SELECT id AS "moduleId", project_id AS "projectId", name FROM app.modules WHERE id = ${moduleId} AND project_id = ${projectId} AND deleted_at IS NULL`;
    return row;
  }

  async listNames(
    tx: TransactionContext,
    input: ModuleNameLookupInput,
  ): Promise<readonly ModuleNameItem[]> {
    if (input.projectIds.length === 0 || input.moduleIds.length === 0) {
      return [];
    }
    const projectIds = [...input.projectIds];
    const moduleIds = [...input.moduleIds];
    return (await tx.sql<ModuleNameItem[]>`
      SELECT id AS "moduleId", project_id AS "projectId", name
        FROM app.modules
       WHERE project_id = ANY(${projectIds}::integer[])
         AND id = ANY(${moduleIds}::integer[])
         AND deleted_at IS NULL
       ORDER BY id ASC
    `) as unknown as readonly ModuleNameItem[];
  }

  async matchByName(
    tx: TransactionContext,
    projectId: number,
    normalizedName: string,
  ): Promise<readonly ModuleNameMatchItem[]> {
    return (await tx.sql<
      ModuleNameMatchItem[]
    >`SELECT id AS "moduleId", project_id AS "projectId", name, code, description, (deleted_at IS NOT NULL) AS deleted FROM app.modules WHERE project_id = ${projectId} AND lower(btrim(name)) = ${normalizedName} ORDER BY id ASC`) as unknown as readonly ModuleNameMatchItem[];
  }

  async count(
    tx: TransactionContext,
    input: ModuleCountInput,
  ): Promise<number> {
    const [row] = await tx.sql<{ total: number }[]>`
      SELECT COUNT(*)::integer AS total
        FROM app.modules
       WHERE project_id = ${input.projectId}
         AND deleted_at IS NULL
    `;
    return row?.total ?? 0;
  }
}
