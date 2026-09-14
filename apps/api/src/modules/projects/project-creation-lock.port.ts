import { Injectable } from "@nestjs/common";
import type { TransactionContext } from "../../database/transaction-context.js";
/** Reserve the parent before any sequence or effect writes in a multi-entity creation.
 * Other project writers take FOR SHARE first; this prevents sequence/audit lock inversion.
 * Caller must authenticate first and authorize the project after acquiring this lock.
 */
@Injectable()
export class ProjectCreationLockPort {
  async lock(tx: TransactionContext, projectId: number): Promise<void> {
    await tx.sql`SELECT id FROM app.projects WHERE id=${projectId} FOR UPDATE`;
  }
}
