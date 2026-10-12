import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { IdempotencyModule } from "../idempotency/idempotency.module.js";
import { DocumentImportRunRepository } from "../modules/document-import/document-import-run.repository.js";
import { FeaturesModule } from "../modules/features/index.js";
import { FeaturesManagementModule } from "../modules/features/features-management.module.js";
import { ModulesModule } from "../modules/modules/index.js";
import { ModulesManagementModule } from "../modules/modules/modules-management.module.js";
import { ProjectCreateModule } from "../modules/projects/project-create.module.js";
import { ProjectsModule } from "../modules/projects/index.js";
import { TasksManagementModule } from "../modules/tasks/index.js";
import { DocumentImportController } from "./document-import.controller.js";
import { DocumentImportHttpService } from "./document-import-http.service.js";
import { DocumentImportWorkflow } from "./document-import.workflow.js";
import { ProjectImportController } from "./project-import.controller.js";

/**
 * ADR-064 文档导入模块：聚合项目、模块、功能与任务四个域的公开 CommandPort
 * 与读端口，在单一事务内按固定模板创建/复用模块与功能并创建任务。
 */
@Module({
  imports: [
    AuthModule,
    AuditModule,
    DatabaseModule,
    IdempotencyModule,
    ProjectsModule,
    ProjectCreateModule,
    ModulesModule,
    ModulesManagementModule,
    FeaturesModule,
    FeaturesManagementModule,
    TasksManagementModule,
  ],
  providers: [
    DocumentImportWorkflow,
    DocumentImportHttpService,
    DocumentImportRunRepository,
  ],
  controllers: [DocumentImportController, ProjectImportController],
})
export class DocumentImportModule {}
