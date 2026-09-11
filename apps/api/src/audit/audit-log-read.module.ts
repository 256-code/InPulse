import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { AuditCursorService } from "./audit-cursor.js";
import { AuditLogController } from "./audit-log.controller.js";
import { AuditQueryService } from "./audit-query.service.js";
import { AuditModule } from "./audit.module.js";

/**
 * F-08 原始审计读取模块。独立于 AuditModule，避免与 AuthModule
 * （已 import AuditModule）形成循环依赖；需要 Session keyring（游标）、
 * AdminHighRiskAuthService（重认证）与 audit_reader 连接。
 */
@Module({
  imports: [AuthModule, DatabaseModule, AuditModule],
  providers: [AuditCursorService, AuditQueryService],
  controllers: [AuditLogController],
})
export class AuditLogReadModule {}
