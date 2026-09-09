import type { TransactionContext } from "../../database/transaction-context.js";
import { ModuleReadPort, type ModuleReadResource } from "./module-read.port.js";

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
}
