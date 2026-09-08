import type { modules } from "@inpulse/database";
import type { TransactionContext } from "../../database/transaction-context.js";

type ModuleInsert = Pick<
  typeof modules.$inferSelect,
  "projectId" | "createdBy" | "name" | "kind"
>;

/** Persistence only; no client, transaction ownership or cross-domain repository. */
export class ModulesRepository {
  async insert(tx: TransactionContext, input: ModuleInsert): Promise<number> {
    const [row] = await tx.sql<{ id: number }[]>`
      INSERT INTO app.modules (project_id, created_by, name, kind)
      VALUES (${input.projectId}, ${input.createdBy}, ${input.name}, ${input.kind})
      RETURNING id
    `;
    if (!row) throw new Error("Module insert returned no ID");
    return row.id;
  }
}
