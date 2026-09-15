import { Inject, Injectable } from "@nestjs/common";
import type { ModuleEditRequest } from "@inpulse/api-contract";
import type { TransactionContext } from "../../database/transaction-context.js";
import { ModulesManagementService } from "./modules-management.service.js";
@Injectable()
export class ModuleCreateCommandPort {
  constructor(
    @Inject(ModulesManagementService)
    private readonly service: ModulesManagementService,
  ) {}
  create(
    tx: TransactionContext,
    actorId: number,
    projectId: number,
    input: ModuleEditRequest,
    requestId: string,
  ) {
    return this.service.execute(tx, {
      operation: "createModule",
      projectId,
      actorId,
      edit: input,
      requestId,
    });
  }
}
