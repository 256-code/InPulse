import { Module } from "@nestjs/common";

import { AuthModule } from "../../auth/auth.module.js";
import { AuditModule } from "../../audit/audit.module.js";
import { DatabaseModule } from "../../database/database.module.js";
import { IdempotencyModule } from "../../idempotency/idempotency.module.js";
import { ActivityProjectionModule } from "../activity/index.js";
import { NotificationProjectionModule } from "../notifications/index.js";
import { SearchProjectionModule } from "../search/index.js";
import { ProjectManagementController } from "./project-management.controller.js";
import { ProjectManagementHttpService } from "./project-management-http.service.js";
import { ProjectManagementService } from "./project-management.service.js";
import { ProjectAutoPurgeScheduler } from "./project-auto-purge.scheduler.js";
import { ProjectAutoPurgeService } from "./project-auto-purge.service.js";
import { ProjectsModule } from "./projects.module.js";

/** F-06 项目编辑、状态变更与归档支柱；写命令只创建一个 UnitOfWork。 */
@Module({
  imports: [
    AuthModule,
    AuditModule,
    DatabaseModule,
    IdempotencyModule,
    ProjectsModule,
    ActivityProjectionModule,
    NotificationProjectionModule,
    SearchProjectionModule,
  ],
  providers: [
    ProjectManagementService,
    ProjectManagementHttpService,
    // ADR-055：保留期到期后的自动彻底删除（后台调度，无 HTTP 入口）。
    ProjectAutoPurgeService,
    ProjectAutoPurgeScheduler,
  ],
  controllers: [ProjectManagementController],
})
export class ProjectManagementModule {}
