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
  /** 项目面板的聚合读取：项目内全部链接 + 来源标注（写入模型不变）。 */
  listProjectLibrary(tx: TransactionContext, projectId: number) {
    return this.repository.listProjectLibrary(tx, projectId);
  }
  exists(tx: TransactionContext, p: number, id: number) {
    return this.repository.exists(tx, p, id);
  }
  /** 项目根仓库的 `owner/repository`；供裸 commit SHA 补全为链接使用。 */
  findRootRepository(tx: TransactionContext, projectId: number) {
    return this.repository.findRootRepository(tx, projectId);
  }
  /** R-3：批量统计任务上的外部链接数（去重后的 link_id 计数）。 */
  countTaskLinks(
    tx: TransactionContext,
    projectIds: readonly number[],
    taskIds: readonly number[],
  ) {
    return this.repository.countTaskLinks(tx, projectIds, taskIds);
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
    isRootRepository = false,
  ) {
    return this.repository.add(tx, p, type, id, actor, url, isRootRepository);
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
  /**
   * ADR-058：目标被删除时解除其全部链接关联，返回解除的关联条数。
   * 只删关联行，`app.external_links` 链接本体与项目面板聚合结果保留。
   */
  detachTarget(
    tx: TransactionContext,
    p: number,
    type: ExternalLinkTargetType,
    id: number,
  ) {
    return this.repository.detachTarget(tx, p, type, id);
  }
}
