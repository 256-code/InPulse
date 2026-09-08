import type { Sql } from "postgres";

import type { TimeCursorValue } from "../../cursors/time-cursor.js";
import type {
  ActivitySourceEntityType,
  ActivityVisibilityScope,
} from "./activity.write-port.js";

export interface ActivityProjectionReadInput {
  readonly projectId: number;
  readonly visibilityScopes: readonly ActivityVisibilityScope[];
  readonly limit: number;
  readonly after: TimeCursorValue | null;
}

export interface ActivityProjectionItem {
  readonly id: string;
  readonly projectId: number;
  readonly sourceEntityType: ActivitySourceEntityType;
  readonly sourceEntityId: number;
  readonly activityType: string;
  readonly actorId: number | null;
  readonly summary: string;
  readonly occurredAt: string;
}

export interface ActivityProjectionPage {
  readonly items: readonly ActivityProjectionItem[];
  readonly last: TimeCursorValue | null;
}

export interface ActivityProjectionReader {
  read(input: ActivityProjectionReadInput): Promise<ActivityProjectionPage>;
}

interface ActivityProjectionRow {
  readonly id: string;
  readonly project_id: number;
  readonly source_entity_type: string;
  readonly source_entity_id: number;
  readonly activity_type: string;
  readonly actor_id: number | null;
  readonly summary: string;
  readonly occurred_at: string;
}

export class PostgresActivityProjectionReader {
  readonly #sql: Sql;

  constructor(sql: Sql) {
    this.#sql = sql;
  }

  async read(
    input: ActivityProjectionReadInput,
  ): Promise<ActivityProjectionPage> {
    if (input.visibilityScopes.length === 0) {
      return { items: [], last: null };
    }
    const rows = await this.#sql.unsafe<ActivityProjectionRow[]>(
      `SELECT
         id::text,
         project_id,
         source_entity_type,
         source_entity_id,
         activity_type,
         actor_id,
         summary,
         to_char(occurred_at AT TIME ZONE 'UTC',
                 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at
       FROM app.activity_projection
      WHERE project_id = $1
        AND visibility_scope = ANY($2::text[])
        AND (
          $3::timestamptz IS NULL
          OR occurred_at < $3::timestamptz
          OR (occurred_at = $3::timestamptz AND id < $4::bigint)
        )
      ORDER BY occurred_at DESC, id DESC
      LIMIT $5`,
      [
        input.projectId,
        [...input.visibilityScopes],
        input.after?.at ?? null,
        input.after?.id ?? "0",
        input.limit + 1,
      ],
    );

    const hasMore = rows.length > input.limit;
    const pageRows = hasMore ? rows.slice(0, input.limit) : rows;
    const last = pageRows.at(-1);
    return {
      items: pageRows.map((row) => ({
        id: row.id,
        projectId: row.project_id,
        sourceEntityType: row.source_entity_type as ActivitySourceEntityType,
        sourceEntityId: row.source_entity_id,
        activityType: row.activity_type,
        actorId: row.actor_id,
        summary: row.summary,
        occurredAt: row.occurred_at,
      })),
      last:
        last === undefined || !hasMore
          ? null
          : { at: last.occurred_at, id: last.id },
    };
  }
}
