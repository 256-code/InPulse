import { Inject, Injectable } from "@nestjs/common";
import type { ExternalLinkTargetType } from "@inpulse/api-contract";
import type { TransactionContext } from "../../database/transaction-context.js";
import { ExternalLinksRepository } from "./external-links.repository.js";
@Injectable()
export class ExternalLinksQueryPort {
  constructor(
    @Inject(ExternalLinksRepository)
    private readonly repository: ExternalLinksRepository,
  ) {}
  list(
    tx: TransactionContext,
    p: number,
    type: ExternalLinkTargetType,
    id: number,
  ) {
    return this.repository.list(tx, p, type, id);
  }
  exists(tx: TransactionContext, p: number, id: number) {
    return this.repository.exists(tx, p, id);
  }
  /** R-4：批量读取记录上的 GitHub 链接快照（只读、不校验项目授权）。 */
  listChangeRecordLinks(
    tx: TransactionContext,
    projectId: number,
    recordIds: readonly number[],
  ) {
    return this.repository.listChangeRecordLinks(tx, projectId, recordIds);
  }
}
@Injectable()
export class ExternalLinksCommandPort {
  constructor(
    @Inject(ExternalLinksRepository)
    private readonly repository: ExternalLinksRepository,
  ) {}
  add(
    tx: TransactionContext,
    p: number,
    type: ExternalLinkTargetType,
    id: number,
    actor: number,
    url: string,
  ) {
    return this.repository.add(tx, p, type, id, actor, url);
  }
  remove(
    tx: TransactionContext,
    p: number,
    type: ExternalLinkTargetType,
    id: number,
    linkId: number,
  ) {
    return this.repository.remove(tx, p, type, id, linkId);
  }
}
