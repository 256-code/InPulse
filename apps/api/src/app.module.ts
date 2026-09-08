import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { HealthController } from "./health/health.controller.js";

/** Secret 未配置时保持健康探针可启动；配置后挂载鉴权模块并 fail closed。 */
const authModules = process.env["SESSION_HASH_KEYRING_FILE"]?.trim()
  ? [AuthModule]
  : [];

@Module({
  imports: [DatabaseModule, ...authModules],
  controllers: [HealthController],
})
export class AppModule {}
