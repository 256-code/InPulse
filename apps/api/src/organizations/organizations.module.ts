import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { AuditModule } from "../audit/audit.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { IdempotencyModule } from "../idempotency/idempotency.module.js";
import { OrganizationMembersController } from "./organization-members.controller.js";
import { OrganizationMembersService } from "./organization-members.service.js";
import { OrganizationsController } from "./organization.controller.js";
import { OrganizationsHttpService } from "./organization-http.service.js";
import { OrganizationRepository } from "./organization.repository.js";
import { OrganizationService } from "./organization.service.js";

/** ADR-081 组织管理支柱；所有写命令只创建一个 UnitOfWork。 */
@Module({
  imports: [AuthModule, AuditModule, DatabaseModule, IdempotencyModule],
  providers: [
    OrganizationRepository,
    OrganizationService,
    OrganizationMembersService,
    OrganizationsHttpService,
  ],
  controllers: [OrganizationsController, OrganizationMembersController],
})
export class OrganizationsModule {}
