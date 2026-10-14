import { Module } from "@nestjs/common";

import { AuditModule } from "../../audit/audit.module.js";
import { AuthModule } from "../../auth/auth.module.js";
import { DatabaseModule } from "../../database/database.module.js";
import { IdempotencyModule } from "../../idempotency/idempotency.module.js";
import { WecomRobotController } from "./wecom-robot.controller.js";
import { WecomRobotConfigRepository } from "./wecom-robot.repository.js";
import { WecomRobotConfigService } from "./wecom-robot.service.js";

/**
 * ADR-070：企业微信机器人凭据的管理员在线配置模块
 * （单行表 + AES-256-GCM 密文，管理页读取与保存）。
 */
@Module({
  imports: [AuthModule, AuditModule, DatabaseModule, IdempotencyModule],
  providers: [WecomRobotConfigRepository, WecomRobotConfigService],
  controllers: [WecomRobotController],
})
export class WecomRobotModule {}
