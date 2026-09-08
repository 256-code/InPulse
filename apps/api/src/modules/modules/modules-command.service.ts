import type { TransactionContext } from "../../database/transaction-context.js";
import {
  ModulesCommandPort,
  UnclassifiedModuleConflictError,
  type CreateUnclassifiedModuleInput,
  type CreateUnclassifiedModuleResult,
} from "./modules.command-port.js";
import type { ModulesRepository } from "./modules.repository.js";

export class ModulesCommandService extends ModulesCommandPort {
  constructor(private readonly repository: ModulesRepository) {
    super();
  }

  async createUnclassifiedModule(
    tx: TransactionContext,
    input: CreateUnclassifiedModuleInput,
  ): Promise<CreateUnclassifiedModuleResult> {
    try {
      const moduleId = await this.repository.insert(tx, {
        projectId: input.projectId,
        createdBy: input.createdBy,
        name: "未分类模块",
        kind: "UNCLASSIFIED",
      });
      return { moduleId };
    } catch (error) {
      // Raw postgres-js errors: either unique index may reject the same duplicate.
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "23505" &&
        "constraint_name" in error &&
        (error.constraint_name === "modules_one_unclassified_unique" ||
          error.constraint_name === "modules_name_project_unique")
      ) {
        throw new UnclassifiedModuleConflictError();
      }
      throw error;
    }
  }
}
