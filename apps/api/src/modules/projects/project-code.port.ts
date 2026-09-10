import type { TransactionContext } from "../../database/transaction-context.js";

/** Caller authorizes and locks the ACTIVE project first. Allocation rolls back with the command. */
export abstract class ProjectCodePort {
  abstract allocateChangeRecordCode(
    tx: TransactionContext,
    projectId: number,
  ): Promise<string>;
  abstract allocateTaskCode(
    tx: TransactionContext,
    projectId: number,
  ): Promise<string>;
  abstract allocateFeatureCode(
    tx: TransactionContext,
    projectId: number,
  ): Promise<string>;
}
