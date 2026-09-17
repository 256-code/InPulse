import type { TransactionContext } from "../../database/transaction-context.js";
import type { PublishedRecord } from "@inpulse/api-contract";
/** F19 caller must prelock the complete parent/aggregate set and set its task DONE in the same tx. */
export abstract class RecordPublicationCommandPort {
  abstract replay(
    tx: TransactionContext,
    actorId: number,
    context: unknown,
  ): Promise<void>;
  abstract publish(
    tx: TransactionContext,
    actorId: number,
    projectId: number,
    recordId: number,
    expectedRowVersion: number,
    requestId: string,
  ): Promise<PublishedRecord>;
  /** F-18 详情页快捷追加：只追加一条遗留问题，其余条目按当前版本原样沿用，仍写一次新版本。 */
  abstract appendLeftover(
    tx: TransactionContext,
    actorId: number,
    projectId: number,
    recordId: number,
    rowVersion: number,
    currentVersion: number,
    content: string,
    requestId: string,
  ): Promise<PublishedRecord>;
}
