import type { TransactionContext } from "../../database/transaction-context.js";
export interface LinkTarget {
  id: number;
  projectId: number;
  moduleId: number | null;
  featureId: number | null;
  status: string;
  rowVersion: number;
}
export interface LinkTargetQueryPort {
  find(
    tx: TransactionContext,
    id: number,
    lock?: boolean,
  ): Promise<LinkTarget | undefined>;
}
export interface LinkTargetCommandPort {
  advance(tx: TransactionContext, target: LinkTarget): Promise<boolean>;
}
