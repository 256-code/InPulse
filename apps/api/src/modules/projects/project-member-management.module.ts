import { Module } from "@nestjs/common";

import { AuthModule } from "../../auth/auth.module.js";
import { AuditModule } from "../../audit/audit.module.js";
import { DatabaseModule } from "../../database/database.module.js";
import { IdempotencyModule } from "../../idempotency/idempotency.module.js";
import { TasksManagementModule } from "../tasks/index.js";
import { ActivityProjectionModule } from "../activity/index.js";
import { NotificationProjectionModule } from "../notifications/index.js";
import { ProjectMemberManagementController } from "./project-member-management.controller.js";
import { ProjectMemberManagementHttpService } from "./project-member-management-http.service.js";
import { ProjectMemberManagementService } from "./project-member-management.service.js";
import { ProjectsModule } from "./projects.module.js";

/** F-05 项目成员管理支柱；写命令只创建一个 UnitOfWork。 */
@Module({
  imports: [
    AuthModule,
    AuditModule,
    DatabaseModule,
    IdempotencyModule,
    ProjectsModule,
    ActivityProjectionModule,
    NotificationProjectionModule,
    TasksManagementModule,
  ],
  providers: [
    ProjectMemberManagementService,
    ProjectMemberManagementHttpService,
  ],
  controllers: [ProjectMemberManagementController],
})
export class ProjectMemberManagementModule {}
