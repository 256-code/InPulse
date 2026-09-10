import { Module } from "@nestjs/common";
import { AuthModule } from "../../auth/auth.module.js";
import { AuditModule } from "../../audit/audit.module.js";
import { DatabaseModule } from "../../database/database.module.js";
import { IdempotencyModule } from "../../idempotency/idempotency.module.js";
import { ProjectsModule } from "../projects/index.js";
import { ModulesModule } from "../modules/index.js";
import { FeaturesModule } from "../features/index.js";
import { TasksManagementModule } from "../tasks/index.js";
import { ActivityProjectionModule } from "../activity/index.js";
import { SearchProjectionModule } from "../search/index.js";
import { NotificationProjectionModule } from "../notifications/index.js";
import { TaskGroupRepository } from "./task-group.repository.js";
import { TaskGroupsService } from "./task-groups.service.js";
import { TaskGroupsHttpService } from "./task-groups-http.service.js";
import { TaskGroupsController } from "./task-groups.controller.js";
@Module({
  imports: [
    AuthModule,
    AuditModule,
    DatabaseModule,
    IdempotencyModule,
    ProjectsModule,
    ModulesModule,
    FeaturesModule,
    TasksManagementModule,
    ActivityProjectionModule,
    SearchProjectionModule,
    NotificationProjectionModule,
  ],
  providers: [TaskGroupRepository, TaskGroupsService, TaskGroupsHttpService],
  controllers: [TaskGroupsController],
})
export class TaskGroupsModule {}
