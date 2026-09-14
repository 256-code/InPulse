import { Module } from "@nestjs/common";
import { AuthModule } from "../../auth/auth.module.js";
import { AuditModule } from "../../audit/audit.module.js";
import { DatabaseModule } from "../../database/database.module.js";
import { IdempotencyModule } from "../../idempotency/idempotency.module.js";
import { ActivityProjectionModule } from "../activity/index.js";
import { SearchProjectionModule } from "../search/index.js";
import { ProjectsModule } from "../projects/index.js";
import { ModulesController } from "./modules.controller.js";
import { ModulesHttpService } from "./modules-http.service.js";
import { ModulesManagementService } from "./modules-management.service.js";
import { ModuleManagementRepository } from "./module-management.repository.js";

@Module({
  imports: [
    AuthModule,
    AuditModule,
    DatabaseModule,
    IdempotencyModule,
    ProjectsModule,
    ActivityProjectionModule,
    SearchProjectionModule,
  ],
  providers: [
    ModuleManagementRepository,
    ModulesManagementService,
    ModulesHttpService,
  ],
  controllers: [ModulesController],
})
export class ModulesManagementModule {}
