import type { TransactionContext } from "../../database/transaction-context.js";
import {
  FeatureReadPort,
  type FeatureCountInput,
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

  async count(
    tx: TransactionContext,
    input: FeatureCountInput,
  ): Promise<number> {
    const moduleId = input.moduleId ?? null;
    const status = input.status ?? null;
    const [row] = await tx.sql<{ total: number }[]>`
      SELECT COUNT(*)::integer AS total
        FROM app.features
       WHERE project_id = ${input.projectId}
         AND (${moduleId}::integer IS NULL OR module_id = ${moduleId})
         AND (${status}::text IS NULL OR status = ${status})
    `;
    return row?.total ?? 0;
  }
}
