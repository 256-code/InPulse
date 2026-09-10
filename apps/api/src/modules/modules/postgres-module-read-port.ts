import type { TransactionContext } from "../../database/transaction-context.js";
import {
  ModuleReadPort,
  type ModuleCountInput,
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
    >`SELECT id AS "moduleId", project_id AS "projectId", name, status FROM app.modules WHERE id = ${moduleId} AND project_id = ${projectId}`;
    return row;
  }

  async count(
    tx: TransactionContext,
    input: ModuleCountInput,
  ): Promise<number> {
    const status = input.status ?? null;
    const [row] = await tx.sql<{ total: number }[]>`
      SELECT COUNT(*)::integer AS total
        FROM app.modules
       WHERE project_id = ${input.projectId}
         AND (${status}::text IS NULL OR status = ${status})
    `;
    return row?.total ?? 0;
  }
}
