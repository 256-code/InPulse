import type { TransactionContext } from "../../database/transaction-context.js";
import {
  FeatureReadPort,
  type FeatureCountInput,
  type FeatureNameItem,
  type FeatureNameLookupInput,
  type FeatureNameMatchItem,
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
    >`SELECT id AS "featureId", project_id AS "projectId", module_id AS "moduleId", name, created_by AS "createdBy" FROM app.features WHERE project_id = ${projectId} AND module_id = ${moduleId} AND id = ${featureId} AND deleted_at IS NULL`;
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
         AND deleted_at IS NULL
       ORDER BY id ASC
    `) as unknown as readonly FeatureNameItem[];
  }

  async matchByName(
    tx: TransactionContext,
    projectId: number,
    moduleId: number,
    normalizedName: string,
  ): Promise<readonly FeatureNameMatchItem[]> {
    return (await tx.sql<
      FeatureNameMatchItem[]
    >`SELECT id AS "featureId", project_id AS "projectId", module_id AS "moduleId", name, code, current_behavior AS "currentBehavior", acceptance_criteria AS "acceptanceCriteria", tags, (deleted_at IS NOT NULL) AS deleted FROM app.features WHERE project_id = ${projectId} AND module_id = ${moduleId} AND lower(btrim(name)) = ${normalizedName} ORDER BY id ASC`) as unknown as readonly FeatureNameMatchItem[];
  }

  async count(
    tx: TransactionContext,
    input: FeatureCountInput,
  ): Promise<number> {
    const moduleId = input.moduleId ?? null;
    const [row] = await tx.sql<{ total: number }[]>`
      SELECT COUNT(*)::integer AS total
        FROM app.features
       WHERE project_id = ${input.projectId}
         AND (${moduleId}::integer IS NULL OR module_id = ${moduleId})
         AND deleted_at IS NULL
    `;
    return row?.total ?? 0;
  }
}
