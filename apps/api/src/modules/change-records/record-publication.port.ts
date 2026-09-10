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
}
