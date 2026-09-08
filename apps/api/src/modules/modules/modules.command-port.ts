import type { modules } from "@inpulse/database";
import type { TransactionContext } from "../../database/transaction-context.js";

export interface CreateUnclassifiedModuleInput {
  readonly projectId: typeof modules.$inferInsert.projectId;
  readonly createdBy: typeof modules.$inferInsert.createdBy;
}

export interface CreateUnclassifiedModuleResult {
  readonly moduleId: typeof modules.$inferSelect.id;
}

/** Internal project bootstrap boundary and Nest injection token.
 * The caller owns authorization and the transaction; propagate failures out of its UoW.
 */
export abstract class ModulesCommandPort {
  abstract createUnclassifiedModule(
    tx: TransactionContext,
    input: CreateUnclassifiedModuleInput,
  ): Promise<CreateUnclassifiedModuleResult>;
}

/** Stable conflict data only; the outer HTTP boundary must map the error envelope. */
export class UnclassifiedModuleConflictError extends Error {
  readonly status = 409;
  readonly code = "UNCLASSIFIED_MODULE_CONFLICT";

  constructor() {
    super("未分类模块或其名称已存在");
    this.name = "UnclassifiedModuleConflictError";
  }
}
