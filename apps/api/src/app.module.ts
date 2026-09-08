import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module.js";
import { AuditModule } from "./audit/audit.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { HealthModule } from "./health/health.module.js";
import { IdempotencyModule } from "./idempotency/idempotency.module.js";
import { ActivityProjectionModule } from "./modules/activity/activity-projection.module.js";
import { ActivityModule } from "./modules/activity/activity.module.js";
import { NotificationProjectionModule } from "./modules/notifications/notification-projection.module.js";
import { NotificationsModule } from "./modules/notifications/notifications.module.js";
import { ProjectsModule } from "./modules/projects/projects.module.js";
import { SearchModule } from "./modules/search/search.module.js";

/** Secret 未配置时保持健康探针可启动；配置后挂载鉴权模块并 fail closed。 */
const authModules = process.env["SESSION_HASH_KEYRING_FILE"]?.trim()
  ? [AuthModule, SearchModule, ActivityModule, NotificationsModule]
  : [];

@Module({
  imports: [
    DatabaseModule,
    IdempotencyModule,
    ProjectsModule,
    AuditModule,
    HealthModule,
    ActivityProjectionModule,
    NotificationProjectionModule,
    ...authModules,
  ],
})
export class AppModule {}
