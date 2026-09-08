import type { TransactionContext } from "../../database/transaction-context.js";
import {
  validateSearchProjectionWriteInput,
  SearchProjectionWritePort,
  type SearchProjectionWriteInput,
} from "./search-projection.write-port.js";

/**
 * 显式接收调用方事务的搜索投影写适配器。
 * 规范化在应用层完成，数据库约束仍是最终防线；旧 source_row_version
 * 不会覆盖已持久化的较新投影状态。
 */
export class PostgresSearchProjectionWritePort extends SearchProjectionWritePort {
  async upsert(
    tx: TransactionContext,
    input: SearchProjectionWriteInput,
  ): Promise<void> {
    const normalizedSearchText = validateSearchProjectionWriteInput(input);

    await tx.sql`
      INSERT INTO app.search_projection (
        project_id,
        entity_type,
        entity_id,
        title,
        summary,
        raw_text,
        normalized_search_text,
        visibility_scope,
        source_status,
        source_row_version
      )
      VALUES (
        ${input.projectId},
        ${input.entityType},
        ${input.entityId},
        ${input.title},
        ${input.summary},
        ${input.rawText},
        ${normalizedSearchText},
        ${input.visibilityScope},
        ${input.sourceStatus},
        ${input.sourceRowVersion}
      )
      ON CONFLICT (project_id, entity_type, entity_id)
      DO UPDATE SET
        title = EXCLUDED.title,
        summary = EXCLUDED.summary,
        raw_text = EXCLUDED.raw_text,
        normalized_search_text = EXCLUDED.normalized_search_text,
        visibility_scope = EXCLUDED.visibility_scope,
        source_status = EXCLUDED.source_status,
        source_row_version = EXCLUDED.source_row_version,
        updated_at = now()
      WHERE app.search_projection.source_row_version <=
            EXCLUDED.source_row_version
    `;
  }
}
