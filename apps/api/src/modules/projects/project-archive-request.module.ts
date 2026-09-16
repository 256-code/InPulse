import { Module } from "@nestjs/common";

import { AuthModule } from "../../auth/auth.module.js";
import { AuditModule } from "../../audit/audit.module.js";
import { DatabaseModule } from "../../database/database.module.js";
import { IdempotencyModule } from "../../idempotency/idempotency.module.js";
import { ActivityProjectionModule } from "../activity/index.js";
import { NotificationProjectionModule } from "../notifications/index.js";
import { SearchProjectionModule } from "../search/index.js";
import { ProjectArchiveRequestController } from "./project-archive-request.controller.js";
import { ProjectArchiveRequestHttpService } from "./project-archive-request-http.service.js";
import { ProjectArchiveRequestService } from "./project-archive-request.service.js";
import { ProjectsModule } from "./projects.module.js";

/** F-06.2 项目归档申请支柱；申请、审核与归档在同一个 UnitOfWork 内完成。 */
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
  providers: [ProjectArchiveRequestService, ProjectArchiveRequestHttpService],
  controllers: [ProjectArchiveRequestController],
})
export class ProjectArchiveRequestModule {}
