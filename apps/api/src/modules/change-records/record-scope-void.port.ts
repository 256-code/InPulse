import { Inject, Injectable } from "@nestjs/common";
import type { TransactionContext } from "../../database/transaction-context.js";
import { RecordLifecycleService } from "./record-lifecycle.service.js";

/**
 * ADR-059：删除模块或功能对记录域的写入边界，由 change-records 域实现。
 * 与 ADR-058 的任务级作废同一口径：聚合命令本身即承担作废后果，不走管理员门禁；
 * 只处理 `PUBLISHED`，草稿与已作废记录都不参与。
 */
export abstract class RecordScopeVoidPort {
  /** `featureId` 为 null 表示整模块（含模块级记录与本模块各功能下的记录）。 */
  abstract voidScopeRecords(
    tx: TransactionContext,
    input: {
      readonly projectId: number;
      readonly moduleId: number;
      readonly featureId: number | null;
      readonly actorId: number;
      readonly requestId: string;
      readonly reason: string;
    },
  ): Promise<readonly { recordId: number; title: string }[]>;
}

@Injectable()
export class RecordLifecycleScopeVoidPort extends RecordScopeVoidPort {
  constructor(
    @Inject(RecordLifecycleService)
    private readonly service: RecordLifecycleService,
  ) {
    super();
  }

  voidScopeRecords(
    tx: TransactionContext,
    input: {
      readonly projectId: number;
      readonly moduleId: number;
      readonly featureId: number | null;
      readonly actorId: number;
      readonly requestId: string;
      readonly reason: string;
    },
  ) {
    return this.service.voidByScopeDeletion(tx, input);
  }
}
