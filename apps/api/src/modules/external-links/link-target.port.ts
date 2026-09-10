import type { TransactionContext } from "../../database/transaction-context.js";
export interface LinkTarget {
  id: number;
  projectId: number;
  moduleId: number | null;
  featureId: number | null;
  status: string;
  rowVersion: number;
}
export type LinkTargetLock = "share" | "update";
/** Shared/read and update locks remain held until the caller transaction ends. */
export interface LinkTargetQueryPort {
  find(
    tx: TransactionContext,
    id: number,
    lock?: LinkTargetLock,
  ): Promise<LinkTarget | undefined>;
}
export interface LinkTargetCommandPort {
  advance(tx: TransactionContext, target: LinkTarget): Promise<boolean>;
}
