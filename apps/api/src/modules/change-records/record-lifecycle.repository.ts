import { Injectable } from "@nestjs/common";
import type { TransactionContext } from "../../database/transaction-context.js";
@Injectable()
export class RecordLifecycleRepository {
  async transition(
    tx: TransactionContext,
    projectId: number,
    recordId: number,
    expectedVersion: number,
    restore: boolean,
    reason: string,
  ) {
    const rows = restore
      ? await tx.sql`UPDATE app.change_records SET status='PUBLISHED',row_version=row_version+1,updated_at=GREATEST(clock_timestamp(),updated_at) WHERE project_id=${projectId} AND id=${recordId} AND status='VOID' AND row_version=${expectedVersion} RETURNING id`
      : await tx.sql`UPDATE app.change_records SET status='VOID',voided_at=clock_timestamp(),void_reason=${reason},row_version=row_version+1,updated_at=GREATEST(clock_timestamp(),updated_at) WHERE project_id=${projectId} AND id=${recordId} AND status='PUBLISHED' AND row_version=${expectedVersion} RETURNING id`;
    return rows.length === 1;
  }
}
