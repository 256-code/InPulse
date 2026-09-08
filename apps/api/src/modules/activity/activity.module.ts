import { Module } from "@nestjs/common";

import type { DatabaseClient } from "@inpulse/database/client";
import { SESSION_HMAC_KEYRING } from "../../auth/auth.constants.js";
import type { VersionedHmacKeyring } from "../../auth/keyring.js";
import { AuthModule } from "../../auth/auth.module.js";
import { TimeCursorService } from "../../cursors/time-cursor.js";
import { DATABASE_CLIENT } from "../../database/database.constants.js";
import { DatabaseModule } from "../../database/database.module.js";
import {
  PROJECT_ACCESS_QUERY_PORT,
  ProjectsModule,
  type ProjectAccessQueryPort,
} from "../projects/index.js";
import { ActivityController } from "./activity.controller.js";
import { PostgresActivityProjectionReader } from "./activity-projection.reader.js";
import { ActivityQueryService } from "./activity-query.service.js";

@Module({
  imports: [AuthModule, DatabaseModule, ProjectsModule],
  providers: [
    {
      provide: PostgresActivityProjectionReader,
      useFactory: (client: DatabaseClient) =>
        new PostgresActivityProjectionReader(client.sql),
      inject: [DATABASE_CLIENT],
    },
    {
      provide: TimeCursorService,
      useFactory: (keyring: VersionedHmacKeyring) =>
        new TimeCursorService(keyring, "ACTIVITY"),
      inject: [SESSION_HMAC_KEYRING],
    },
    {
      provide: ActivityQueryService,
      useFactory: (
        projectAccess: ProjectAccessQueryPort,
        reader: PostgresActivityProjectionReader,
        cursor: TimeCursorService,
      ) => new ActivityQueryService(projectAccess, reader, cursor),
      inject: [
        PROJECT_ACCESS_QUERY_PORT,
        PostgresActivityProjectionReader,
        TimeCursorService,
      ],
    },
  ],
  controllers: [ActivityController],
})
export class ActivityModule {}
