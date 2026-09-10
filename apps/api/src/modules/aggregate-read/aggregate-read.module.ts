import { Module } from "@nestjs/common";

import type { VersionedHmacKeyring } from "../../auth/keyring.js";
import { SESSION_HMAC_KEYRING } from "../../auth/auth.constants.js";
import { AuthModule } from "../../auth/auth.module.js";
import { DatabaseModule } from "../../database/database.module.js";
import { PublishedRecordsModule } from "../change-records/index.js";
import { ExternalLinksModule } from "../external-links/index.js";
import { FeaturesModule } from "../features/index.js";
import { ModulesModule } from "../modules/index.js";
import { ProjectsModule } from "../projects/index.js";
import { TaskGroupsModule } from "../task-groups/index.js";
import { TasksManagementModule } from "../tasks/index.js";
import { AggregateReadCursorService } from "./aggregate-read-cursor.js";
import { MyTasksController } from "./my-tasks.controller.js";
import { MyTasksQueryService } from "./my-tasks-query.service.js";
import { ProjectOverviewController } from "./project-overview.controller.js";
import { ProjectOverviewQueryService } from "./project-overview-query.service.js";
import { TaskGroupReadController } from "./task-group-read.controller.js";
import { TaskGroupQueryService } from "./task-group-query.service.js";

/**
 * F-25 / F-29 / F-32 聚合读宿主模块（A 裁决 §6 附带要求）。
 *
 * 只依赖 A 的 ProjectAccessQueryPort / ProjectQueryPort 与 B、C 已发布的公开
 * QueryPort，不导出任何 Repository、不注册命令端口、不参与任何命令 UnitOfWork；
 * 三条路由的授权全部在服务层通过服务端 AuthorizedProjectScope 完成。
 */
@Module({
  imports: [
    AuthModule,
    DatabaseModule,
    ProjectsModule,
    ModulesModule,
    FeaturesModule,
    TasksManagementModule,
    PublishedRecordsModule,
    TaskGroupsModule,
    ExternalLinksModule,
  ],
  providers: [
    {
      provide: AggregateReadCursorService,
      useFactory: (keyring: VersionedHmacKeyring) =>
        new AggregateReadCursorService(keyring),
      inject: [SESSION_HMAC_KEYRING],
    },
    TaskGroupQueryService,
    ProjectOverviewQueryService,
    MyTasksQueryService,
  ],
  controllers: [
    TaskGroupReadController,
    ProjectOverviewController,
    MyTasksController,
  ],
})
export class AggregateReadModule {}
