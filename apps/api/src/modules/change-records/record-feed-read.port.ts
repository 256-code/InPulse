import { Injectable } from "@nestjs/common";
import type { ReadableRecord, RecordDraftItem } from "@inpulse/api-contract";

import type { TimeCursorValue } from "../../cursors/time-cursor.js";
import type { TransactionContext } from "../../database/transaction-context.js";
import type {
  RecordFeedListInput,
  RecordFeedListPage,
  RecordFeedSourceFilter,
} from "./published-record.repository.js";
import { PublishedRecordRepository } from "./published-record.repository.js";
import type {
  MyRecordDraftListInput,
  MyRecordDraftListPage,
} from "./record-draft.repository.js";
import { RecordDraftRepository } from "./record-draft.repository.js";

export type { RecordFeedSourceFilter };

/** B-3b 跨项目记录读端口入参；projectIds 必须来自服务端 AuthorizedProjectScope，端口不校验授权。 */
export interface RecordFeedPageInput {
  readonly projectIds: readonly number[];
  /** 已按调用方可见性收敛的 status 集合（非管理员不出现 VOID）。 */
  readonly statuses: readonly ("PUBLISHED" | "VOID")[];
  readonly visibilityScopes: readonly ("MEMBER" | "ADMIN_ONLY")[];
  readonly source: RecordFeedSourceFilter | null;
  /** 归一化后的检索词；null 表示不启用全文过滤。 */
  readonly normalizedQuery: string | null;
  readonly limit: number;
  readonly after: TimeCursorValue | null;
}

export interface RecordFeedPageResult {
  readonly items: readonly ReadableRecord[];
  readonly last: TimeCursorValue | null;
  readonly hasMore: boolean;
}

/** B-3b 我的草稿入参；authorId 必须来自当前认证 actor，projectIds 来自 AuthorizedProjectScope。 */
export interface MyRecordDraftPageInput {
  readonly authorId: number;
  readonly projectIds: readonly number[];
  readonly limit: number;
  readonly after: TimeCursorValue | null;
}

export interface MyRecordDraftPageResult {
  readonly items: readonly RecordDraftItem[];
  readonly last: TimeCursorValue | null;
  readonly hasMore: boolean;
}

/**
 * B-3b 跨项目记录读（跨项目记录清单 + 全局我的草稿）。聚合读宿主与其它跨域
 * 消费方只通过本端口取行，不直接依赖 change-records 的内部 Repository；文档
 * 形状（ReadableRecord / RecordDraftItem）与 B-1 单项目读保持一致，名称回填
 * 由应用层按本页可见范围批量完成。
 */
export abstract class RecordFeedReadPort {
  abstract listFeedPage(
    tx: TransactionContext,
    input: RecordFeedPageInput,
  ): Promise<RecordFeedPageResult>;

  abstract listMyDraftsPage(
    tx: TransactionContext,
    input: MyRecordDraftPageInput,
  ): Promise<MyRecordDraftPageResult>;
}

@Injectable()
export class PostgresRecordFeedReadPort extends RecordFeedReadPort {
  constructor(
    private readonly published: PublishedRecordRepository,
    private readonly drafts: RecordDraftRepository,
  ) {
    super();
  }

  async listFeedPage(
    tx: TransactionContext,
    input: RecordFeedPageInput,
  ): Promise<RecordFeedPageResult> {
    const page: RecordFeedListPage = await this.published.listFeedPage(tx, {
      projectIds: input.projectIds,
      statuses: input.statuses,
      source: input.source,
      normalizedQuery: input.normalizedQuery,
      visibilityScopes: input.visibilityScopes,
      limit: input.limit,
      after: input.after,
    } satisfies RecordFeedListInput);
    return { items: page.items, last: page.last, hasMore: page.hasMore };
  }

  async listMyDraftsPage(
    tx: TransactionContext,
    input: MyRecordDraftPageInput,
  ): Promise<MyRecordDraftPageResult> {
    const page: MyRecordDraftListPage = await this.drafts.listMyDraftsPage(tx, {
      authorId: input.authorId,
      projectIds: input.projectIds,
      limit: input.limit,
      after: input.after,
    } satisfies MyRecordDraftListInput);
    return { items: page.items, last: page.last, hasMore: page.hasMore };
  }
}
