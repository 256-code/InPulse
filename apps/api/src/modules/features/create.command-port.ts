import { Inject, Injectable } from "@nestjs/common";
import type { FeatureEditRequest } from "@inpulse/api-contract";
import type { TransactionContext } from "../../database/transaction-context.js";
import { FeaturesManagementService } from "./features-management.service.js";
@Injectable()
export class FeatureCreateCommandPort {
  constructor(
    @Inject(FeaturesManagementService)
    private readonly service: FeaturesManagementService,
  ) {}
  create(
    tx: TransactionContext,
    actorId: number,
    projectId: number,
    moduleId: number,
    input: FeatureEditRequest,
    requestId: string,
  ) {
    return this.service.execute(tx, {
      operation: "createFeature",
      projectId,
      moduleId,
      actorId,
      edit: input,
      requestId,
    });
  }
}
