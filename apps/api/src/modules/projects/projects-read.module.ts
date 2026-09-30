import { ActiveMembersController } from "./active-members.controller.js";
import { ActiveMembersService } from "./active-members.service.js";
import { Module } from "@nestjs/common";

import type { DatabaseClient } from "@inpulse/database/client";
import { SESSION_HMAC_KEYRING } from "../../auth/auth.constants.js";
import type { VersionedHmacKeyring } from "../../auth/keyring.js";
import { AuthModule } from "../../auth/auth.module.js";
import { TimeCursorService } from "../../cursors/time-cursor.js";
import { DATABASE_CLIENT } from "../../database/database.constants.js";
import { DatabaseModule } from "../../database/database.module.js";
import { ProjectDeletionsController } from "./project-deletions.controller.js";
import {
  PROJECT_DELETION_CURSOR_NAMESPACE,
  ProjectDeletionsQueryService,
} from "./project-deletions.query.service.js";
import { ProjectsReadController } from "./projects-read.controller.js";
import { ProjectsReadService } from "./projects-read.service.js";
import { ProjectsModule } from "./projects.module.js";

/** F-05.1 项目只读 HTTP 纵切片；仅在有认证 Secret 时由 AppModule 挂载。 */
@Module({
  imports: [AuthModule, DatabaseModule, ProjectsModule],
  providers: [
    ProjectsReadService,
    ActiveMembersService,
    {
      provide: TimeCursorService,
      useFactory: (keyring: VersionedHmacKeyring) =>
        new TimeCursorService(keyring, PROJECT_DELETION_CURSOR_NAMESPACE),
      inject: [SESSION_HMAC_KEYRING],
    },
    {
      provide: ProjectDeletionsQueryService,
      useFactory: (client: DatabaseClient, cursor: TimeCursorService) =>
        new ProjectDeletionsQueryService(client.sql, cursor),
      inject: [DATABASE_CLIENT, TimeCursorService],
    },
  ],
  controllers: [
    ProjectsReadController,
    ActiveMembersController,
    ProjectDeletionsController,
  ],
})
export class ProjectsReadModule {}
