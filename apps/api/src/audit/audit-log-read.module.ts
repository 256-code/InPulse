import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { AuditCursorService } from "./audit-cursor.js";
import { AuditLogController } from "./audit-log.controller.js";
import { AuditQueryService } from "./audit-query.service.js";

/**
 * F-08 原始审计读取模块。读取不写审计（ADR-060），因此不再依赖
 * AuditModule；需要 Session keyring（游标）、AdminHighRiskAuthService
 * （管理员高风险门禁）与 audit_reader 连接。
 */
@Module({
  imports: [AuthModule, DatabaseModule],
  providers: [AuditCursorService, AuditQueryService],
  controllers: [AuditLogController],
})
export class AuditLogReadModule {}
