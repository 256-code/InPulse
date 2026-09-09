import { ModulesModule } from "../modules/index.js";
import { FeatureCandidatesQueryPort } from "../search/index.js";
import { Module } from "@nestjs/common";
import { AuthModule } from "../../auth/auth.module.js";
import { AuditModule } from "../../audit/audit.module.js";
import { DatabaseModule } from "../../database/database.module.js";
import { IdempotencyModule } from "../../idempotency/idempotency.module.js";
import { ActivityProjectionModule } from "../activity/index.js";
import { SearchProjectionModule } from "../search/index.js";
import { ProjectsModule } from "../projects/index.js";
import { FeaturesController } from "./features.controller.js";
import { FeaturesHttpService } from "./features-http.service.js";
import { FeaturesManagementService } from "./features-management.service.js";
import { FeatureManagementRepository } from "./feature-management.repository.js";

@Module({
  imports: [
    AuthModule,
    ModulesModule,
    AuditModule,
    DatabaseModule,
    IdempotencyModule,
    ProjectsModule,
    ActivityProjectionModule,
    SearchProjectionModule,
  ],
  providers: [
    FeatureCandidatesQueryPort,
    FeatureManagementRepository,
    FeaturesManagementService,
    FeaturesHttpService,
  ],
  controllers: [FeaturesController],
})
export class FeaturesManagementModule {}
