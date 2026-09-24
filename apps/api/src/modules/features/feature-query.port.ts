import type { TransactionContext } from "../../database/transaction-context.js";

export interface CheckFeatureForWriteInput {
  readonly projectId: number;
  readonly moduleId: number;
  readonly featureId: number;
}

export interface FeatureForWriteResource extends CheckFeatureForWriteInput {
  readonly rowVersion: number;
}

/**
 * ADR-045：功能不再有归档只读态，写前检查只区分「存在 + 归属」与「不存在」；
 * 功能下级的父级 FOR SHARE 取锁仍由本 Port 承担。
 */
export type FeatureWriteCheckResult =
  | { readonly kind: "allowed"; readonly resource: FeatureForWriteResource }
  | { readonly kind: "not-found" };

/** Caller authorizes and locks parents first; this check holds FOR SHARE until tx ends. */
export abstract class FeatureQueryPort {
  abstract checkFeatureForWrite(
    tx: TransactionContext,
    input: CheckFeatureForWriteInput,
  ): Promise<FeatureWriteCheckResult>;
}
