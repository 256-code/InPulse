import type { TransactionContext } from "../../database/transaction-context.js";
import {
  FeatureQueryPort,
  type CheckFeatureForWriteInput,
  type FeatureForWriteResource,
  type FeatureWriteCheckResult,
} from "./feature-query.port.js";

export class PostgresFeatureQueryPort extends FeatureQueryPort {
  async checkFeatureForWrite(
    tx: TransactionContext,
    input: CheckFeatureForWriteInput,
  ): Promise<FeatureWriteCheckResult> {
    const [resource] = await tx.sql<FeatureForWriteResource[]>`
      SELECT id AS "featureId", project_id AS "projectId",
        module_id AS "moduleId", status, row_version AS "rowVersion"
      FROM app.features
      WHERE id = ${input.featureId} AND project_id = ${input.projectId}
        AND module_id = ${input.moduleId}
      FOR SHARE
    `;
    if (!resource) return { kind: "not-found" };
    return resource.status === "ACTIVE"
      ? { kind: "allowed", resource }
      : { kind: "parent-not-active", resource };
  }
}
