import type { TransactionContext } from "../../database/transaction-context.js";
import type { AuthorizedProjectScope } from "../projects/index.js";
import { normalizeSearchText } from "./search-text.js";

/** Keyword candidates only. Caller supplies server-authorized scope; SQL filters before LIMIT. */
export class FeatureCandidatesQueryPort {
  async find(
    tx: TransactionContext,
    scope: AuthorizedProjectScope,
    projectId: number,
    query: string,
  ): Promise<readonly number[]> {
    if (!scope.projectIds.includes(projectId)) return [];
    const rows = await tx.sql<
      { entityId: number }[]
    >`SELECT entity_id AS "entityId" FROM app.search_projection WHERE project_id = ${projectId} AND entity_type = 'FEATURE' AND visibility_scope = 'MEMBER' AND normalized_search_text &@~ app.pgroonga_query_escape(${normalizeSearchText(query)}) ORDER BY id LIMIT 10`;
    return rows.map((row) => row.entityId);
  }
}
