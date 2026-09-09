import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module.js";
import { HealthController } from "./health.controller.js";
import { HealthService } from "./health.service.js";

/** 存活/就绪检查模块（系统设计 / 技术设计 §11.3）。 */
@Module({
  imports: [DatabaseModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
