import type { TransactionContext } from "../../database/transaction-context.js";
import {
  ActivityWritePort,
  validateActivityVisibilityUpdateInput,
  validateActivityWriteInput,
  type ActivityVisibilityUpdateInput,
  type ActivityWriteInput,
} from "./activity.write-port.js";

/**
 * 显式接收调用方事务的活动投影写适配器。来源审计唯一约束由数据库兜底；
 * 可见性更新只允许向更高版本推进，避免过期事件覆盖最新状态。
 */
export class PostgresActivityWritePort extends ActivityWritePort {
  async append(
    tx: TransactionContext,
    input: ActivityWriteInput,
  ): Promise<void> {
    validateActivityWriteInput(input);
    await tx.sql`
      INSERT INTO app.activity_projection (
        project_id,
        source_chain_id,
        source_sequence,
        source_entity_type,
        source_entity_id,
        activity_type,
        actor_id,
        summary,
        metadata,
        visibility_scope,
        source_status,
        source_row_version,
        occurred_at
      )
      VALUES (
        ${input.projectId},
        ${input.sourceChainId},
        ${input.sourceSequence},
        ${input.sourceEntityType},
        ${input.sourceEntityId},
        ${input.activityType},
        ${input.actorId},
        ${input.summary},
        ${JSON.stringify(input.metadata)},
        ${input.visibilityScope},
        ${input.sourceStatus},
        ${input.sourceRowVersion},
        ${input.occurredAt.toISOString()}
      )
      ON CONFLICT (source_chain_id, source_sequence) DO NOTHING
    `;
  }

  async updateEntityVisibility(
    tx: TransactionContext,
    input: ActivityVisibilityUpdateInput,
  ): Promise<void> {
    validateActivityVisibilityUpdateInput(input);
    await tx.sql`
      UPDATE app.activity_projection
         SET visibility_scope = ${input.visibilityScope},
             source_status = ${input.sourceStatus},
             source_row_version = ${input.sourceRowVersion}
       WHERE project_id = ${input.projectId}
         AND source_entity_type = ${input.sourceEntityType}
         AND source_entity_id = ${input.sourceEntityId}
         AND source_row_version < ${input.sourceRowVersion}
    `;
  }
}
