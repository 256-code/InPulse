import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module.js";
import { AuditModule } from "./audit/audit.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { HealthController } from "./health/health.controller.js";
import { IdempotencyModule } from "./idempotency/idempotency.module.js";
import { ProjectsModule } from "./modules/projects/projects.module.js";
import { SearchModule } from "./modules/search/search.module.js";

/** Secret 未配置时保持健康探针可启动；配置后挂载鉴权模块并 fail closed。 */
const authModules = process.env["SESSION_HASH_KEYRING_FILE"]?.trim()
  ? [AuthModule, SearchModule]
  : [];

@Module({
  imports: [
    DatabaseModule,
    IdempotencyModule,
    ProjectsModule,
    AuditModule,
    ...authModules,
  ],
  controllers: [HealthController],
})
export class AppModule {}
