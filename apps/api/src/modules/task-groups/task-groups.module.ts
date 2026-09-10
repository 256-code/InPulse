import { Module } from "@nestjs/common";
import {
  TaskBranchQueryPort,
  PostgresTaskBranchQueryPort,
} from "./task-branch-query.port.js";
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
import { TaskGroupUnmergeHttpService } from "./task-group-unmerge-http.service.js";
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
  providers: [
    TaskGroupRepository,
    TaskGroupsService,
    TaskGroupsHttpService,
    { provide: TaskBranchQueryPort, useClass: PostgresTaskBranchQueryPort },
    TaskGroupUnmergeHttpService,
  ],
  exports: [TaskBranchQueryPort],
  controllers: [TaskGroupsController],
})
export class TaskGroupsModule {}
