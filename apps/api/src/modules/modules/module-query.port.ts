import type { TransactionContext } from "../../database/transaction-context.js";

export interface CheckModuleForWriteInput {
  readonly projectId: number;
  readonly moduleId: number;
}

export interface ModuleForWriteResource extends CheckModuleForWriteInput {
  readonly status: "ACTIVE" | "ARCHIVED";
  readonly rowVersion: number;
}

export type ModuleWriteCheckResult =
  | { readonly kind: "allowed"; readonly resource: ModuleForWriteResource }
  | { readonly kind: "not-found" }
  | {
      readonly kind: "parent-not-active";
      readonly resource: ModuleForWriteResource;
    };

/** Caller authorizes and locks parents first; this check holds FOR SHARE until tx ends. */
export abstract class ModuleQueryPort {
  abstract checkModuleForWrite(
    tx: TransactionContext,
    input: CheckModuleForWriteInput,
  ): Promise<ModuleWriteCheckResult>;
}
