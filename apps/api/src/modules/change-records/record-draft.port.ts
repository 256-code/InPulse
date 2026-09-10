import type {
  RecordDraftContent,
  RecordDraftItem,
} from "@inpulse/api-contract";
import type { TransactionContext } from "../../database/transaction-context.js";
export interface RecordSourceSnapshot {
  taskId: number;
  projectId: number;
  moduleId: number;
  featureId: number | null;
  assigneeId: number;
  impactFeatureIds: number[];
}
/** Workflow has authorized/locked the real source and parents in the shared transaction. */
export abstract class RecordDraftCommandPort {
  abstract createFromTask(
    tx: TransactionContext,
    actorId: number,
    source: RecordSourceSnapshot,
    content: RecordDraftContent,
    requestId: string,
  ): Promise<RecordDraftItem>;
  abstract updateFromTask(
    tx: TransactionContext,
    actorId: number,
    source: RecordSourceSnapshot,
    recordId: number,
    version: number,
    content: RecordDraftContent,
    requestId: string,
  ): Promise<RecordDraftItem>;
}
export abstract class RecordDraftQueryPort {
  abstract findDraft(
    tx: TransactionContext,
    projectId: number,
    recordId: number,
  ): Promise<RecordDraftItem | undefined>;
  abstract listForTask(
    tx: TransactionContext,
    projectId: number,
    taskId: number,
  ): Promise<RecordDraftItem[]>;
}
