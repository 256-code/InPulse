import { Module } from "@nestjs/common";

import { AuthModule } from "../../auth/auth.module.js";
import { AuditModule } from "../../audit/audit.module.js";
import { DatabaseModule } from "../../database/database.module.js";
import { IdempotencyModule } from "../../idempotency/idempotency.module.js";
import { ActivityProjectionModule } from "../activity/index.js";
import { SearchProjectionModule } from "../search/index.js";
import { ProjectManagementController } from "./project-management.controller.js";
import { ProjectManagementHttpService } from "./project-management-http.service.js";
import { ProjectManagementService } from "./project-management.service.js";
import { ProjectsModule } from "./projects.module.js";

/** F-06.1 项目编辑支柱；写命令只创建一个 UnitOfWork。 */
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
  providers: [ProjectManagementService, ProjectManagementHttpService],
  controllers: [ProjectManagementController],
})
export class ProjectManagementModule {}
