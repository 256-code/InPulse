import { Inject, Injectable } from "@nestjs/common";
import type { TransactionContext } from "../../database/transaction-context.js";
import { RecordLifecycleService } from "./record-lifecycle.service.js";

/**
 * ADR-058：删除任务对记录域的写入边界，由 change-records 域实现。
 * 作废不走管理员门禁——删除任务本身即承担作废后果；具体原因由调用方写入审计。
 */
export abstract class TaskRecordVoidPort {
  abstract voidTaskRecords(
    tx: TransactionContext,
    input: {
      readonly projectId: number;
      readonly taskId: number;
      readonly actorId: number;
      readonly requestId: string;
      readonly reason: string;
    },
  ): Promise<readonly { recordId: number; title: string }[]>;
}

@Injectable()
export class RecordLifecycleTaskRecordVoidPort extends TaskRecordVoidPort {
  constructor(
    @Inject(RecordLifecycleService)
    private readonly service: RecordLifecycleService,
  ) {
    super();
  }

  voidTaskRecords(
    tx: TransactionContext,
    input: {
      readonly projectId: number;
      readonly taskId: number;
      readonly actorId: number;
      readonly requestId: string;
      readonly reason: string;
    },
  ) {
    return this.service.voidByTaskDeletion(tx, input);
  }
}
