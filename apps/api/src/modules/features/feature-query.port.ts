import type { TransactionContext } from "../../database/transaction-context.js";

export interface CheckFeatureForWriteInput {
  readonly projectId: number;
  readonly moduleId: number;
  readonly featureId: number;
}

export interface FeatureForWriteResource extends CheckFeatureForWriteInput {
  readonly status: "ACTIVE" | "ARCHIVED";
  readonly rowVersion: number;
}

export type FeatureWriteCheckResult =
  | { readonly kind: "allowed"; readonly resource: FeatureForWriteResource }
  | { readonly kind: "not-found" }
  | {
      readonly kind: "parent-not-active";
      readonly resource: FeatureForWriteResource;
    };

/** Caller authorizes and locks parents first; this check holds FOR SHARE until tx ends. */
export abstract class FeatureQueryPort {
  abstract checkFeatureForWrite(
    tx: TransactionContext,
    input: CheckFeatureForWriteInput,
  ): Promise<FeatureWriteCheckResult>;
}
