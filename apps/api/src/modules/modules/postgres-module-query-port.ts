import type { TransactionContext } from "../../database/transaction-context.js";
import {
  ModuleQueryPort,
  type CheckModuleForWriteInput,
  type ModuleForWriteResource,
  type ModuleWriteCheckResult,
} from "./module-query.port.js";

export class PostgresModuleQueryPort extends ModuleQueryPort {
  async checkModuleForWrite(
    tx: TransactionContext,
    input: CheckModuleForWriteInput,
  ): Promise<ModuleWriteCheckResult> {
    const [resource] = await tx.sql<ModuleForWriteResource[]>`
      SELECT id AS "moduleId", project_id AS "projectId",
        status, row_version AS "rowVersion"
      FROM app.modules
      WHERE id = ${input.moduleId} AND project_id = ${input.projectId}
      FOR SHARE
    `;
    if (!resource) return { kind: "not-found" };
    return resource.status === "ACTIVE"
      ? { kind: "allowed", resource }
      : { kind: "parent-not-active", resource };
  }
}
