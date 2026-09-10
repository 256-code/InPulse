import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { IdempotencyModule } from "../idempotency/idempotency.module.js";
import { ProjectsModule } from "../modules/projects/index.js";
import { ModulesModule } from "../modules/modules/index.js";
import { FeaturesModule } from "../modules/features/index.js";
import { TasksManagementModule } from "../modules/tasks/index.js";
import { TaskGroupsModule } from "../modules/task-groups/index.js";
import {
  RecordDraftsModule,
  PublishedRecordsModule,
} from "../modules/change-records/index.js";
import { TaskCompletionWorkflow } from "./task-completion.workflow.js";
import { TaskCompletionHttpService } from "./task-completion-http.service.js";
import { TaskCompletionController } from "./task-completion.controller.js";
import { TaskStatusCompatibilityController } from "./task-status-compatibility.controller.js";
import { TaskStatusCompatibilityHttpService } from "./task-status-compatibility-http.service.js";
@Module({
  imports: [
    AuthModule,
    DatabaseModule,
    IdempotencyModule,
    ProjectsModule,
    ModulesModule,
    FeaturesModule,
    TasksManagementModule,
    TaskGroupsModule,
    RecordDraftsModule,
    PublishedRecordsModule,
  ],
  providers: [
    TaskCompletionWorkflow,
    TaskCompletionHttpService,
    TaskStatusCompatibilityHttpService,
  ],
  controllers: [TaskCompletionController, TaskStatusCompatibilityController],
})
export class TaskCompletionModule {}
