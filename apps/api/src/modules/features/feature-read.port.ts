import type { TransactionContext } from "../../database/transaction-context.js";

export interface FeatureReadResource {
  readonly featureId: number;
  readonly projectId: number;
  readonly moduleId: number;
  readonly name: string;
  readonly status: "ACTIVE" | "ARCHIVED";
}
/** Caller authorizes project access. Includes archived history. */
export abstract class FeatureReadPort {
  abstract find(
    tx: TransactionContext,
    projectId: number,
    moduleId: number,
    featureId: number,
  ): Promise<FeatureReadResource | undefined>;
}
