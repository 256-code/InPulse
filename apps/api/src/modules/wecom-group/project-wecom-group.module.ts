import { Module } from "@nestjs/common";

import { AuthModule } from "../../auth/auth.module.js";
import { AuditModule } from "../../audit/audit.module.js";
import { DatabaseModule } from "../../database/database.module.js";
import { IdempotencyModule } from "../../idempotency/idempotency.module.js";
import { ProjectsModule } from "../projects/index.js";
import { ProjectWecomGroupController } from "./project-wecom-group.controller.js";
import { ProjectWecomGroupHttpService } from "./project-wecom-group-http.service.js";
import { ProjectWecomGroupService } from "./project-wecom-group.service.js";

/** ADR-076 项目企微群绑定支柱；读路径独立事务，写命令只创建一个 UnitOfWork。 */
@Module({
  imports: [
    AuthModule,
    AuditModule,
    DatabaseModule,
    IdempotencyModule,
    ProjectsModule,
  ],
  providers: [ProjectWecomGroupService, ProjectWecomGroupHttpService],
  controllers: [ProjectWecomGroupController],
})
export class ProjectWecomGroupModule {}
