import type { TransactionContext } from "../../database/transaction-context.js";
import {
  FeatureReadPort,
  type FeatureReadResource,
} from "./feature-read.port.js";

export class PostgresFeatureReadPort extends FeatureReadPort {
  async find(
    tx: TransactionContext,
    projectId: number,
    moduleId: number,
    featureId: number,
  ): Promise<FeatureReadResource | undefined> {
    const [row] = await tx.sql<
      FeatureReadResource[]
    >`SELECT id AS "featureId", project_id AS "projectId", module_id AS "moduleId", name, status, created_by AS "createdBy" FROM app.features WHERE project_id = ${projectId} AND module_id = ${moduleId} AND id = ${featureId}`;
    return row;
  }
}
