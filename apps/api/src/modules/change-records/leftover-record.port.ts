import { Inject, Injectable } from "@nestjs/common";
import type { PublishedRecord } from "@inpulse/api-contract";
import type { TransactionContext } from "../../database/transaction-context.js";
import { LeftoverRecordRepository } from "./leftover-record.repository.js";
import { RecordDraftError } from "./record-drafts.service.js";
export interface LockedLeftover {
  id: number;
  status: "ACTIVE" | "CONVERTED" | "RESOLVED";
  rowVersion: number;
  linkedTaskId: number | null;
}
export abstract class LeftoverRecordCommandPort {
  abstract find(
    tx: TransactionContext,
    p: number,
    r: number,
  ): Promise<PublishedRecord | undefined>;
  abstract lock(
    tx: TransactionContext,
    p: number,
    r: number,
  ): Promise<PublishedRecord | undefined>;
  abstract lockItem(
    tx: TransactionContext,
    p: number,
    r: number,
    item: number,
  ): Promise<LockedLeftover | undefined>;
  abstract convert(
    tx: TransactionContext,
    record: PublishedRecord,
    item: LockedLeftover,
    taskId: number,
    actorId: number,
  ): Promise<void>;
  abstract source(
    tx: TransactionContext,
    p: number,
    taskId: number,
  ): Promise<{
    projectId: number;
    recordId: number;
    leftoverItemId: number;
  } | null>;
}
@Injectable()
export class PostgresLeftoverRecordCommandPort extends LeftoverRecordCommandPort {
  constructor(
    @Inject(LeftoverRecordRepository)
    private readonly repository: LeftoverRecordRepository,
  ) {
    super();
  }
  find(tx: TransactionContext, p: number, r: number) {
    return this.repository.find(tx, p, r);
  }
  lock(tx: TransactionContext, p: number, r: number) {
    return this.repository.lock(tx, p, r);
  }
  lockItem(tx: TransactionContext, p: number, r: number, item: number) {
    return this.repository.lockItem(tx, p, r, item);
  }
  source(tx: TransactionContext, p: number, taskId: number) {
    return this.repository.source(tx, p, taskId);
  }
  async convert(
    tx: TransactionContext,
    record: PublishedRecord,
    item: LockedLeftover,
    taskId: number,
    actorId: number,
  ) {
    if (
      item.status !== "ACTIVE" ||
      item.linkedTaskId !== null ||
      !(await this.repository.link(tx, record, item, taskId, actorId))
    )
      throw new RecordDraftError(
        409,
        "LEFTOVER_CONFLICT",
        "遗留项已变化，请刷新后重试",
      );
  }
}
