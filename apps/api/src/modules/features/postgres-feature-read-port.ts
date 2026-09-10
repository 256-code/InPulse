import type { TransactionContext } from "../../database/transaction-context.js";
import {
  FeatureReadPort,
  type FeatureCountInput,
  type FeatureNameItem,
  type FeatureNameLookupInput,
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

  async listNames(
    tx: TransactionContext,
    input: FeatureNameLookupInput,
  ): Promise<readonly FeatureNameItem[]> {
    if (input.projectIds.length === 0 || input.featureIds.length === 0) {
      return [];
    }
    const projectIds = [...input.projectIds];
    const featureIds = [...input.featureIds];
    return (await tx.sql<FeatureNameItem[]>`
      SELECT id AS "featureId", project_id AS "projectId", module_id AS "moduleId", name
        FROM app.features
       WHERE project_id = ANY(${projectIds}::integer[])
         AND id = ANY(${featureIds}::integer[])
       ORDER BY id ASC
    `) as unknown as readonly FeatureNameItem[];
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
