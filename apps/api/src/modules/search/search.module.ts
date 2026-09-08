import { Module } from "@nestjs/common";

import type { DatabaseClient } from "@inpulse/database/client";
import { AuthModule } from "../../auth/auth.module.js";
import { DATABASE_CLIENT } from "../../database/database.constants.js";
import { DatabaseModule } from "../../database/database.module.js";
import {
  PROJECT_ACCESS_QUERY_PORT,
  ProjectsModule,
  type ProjectAccessQueryPort,
} from "../projects/index.js";
import { SearchController } from "./search.controller.js";
import { SearchCursorService } from "./search-cursor.js";
import { PostgresSearchProjectionReader } from "./search-projection.reader.js";
import { SearchQueryService } from "./search-query.service.js";

@Module({
  imports: [AuthModule, DatabaseModule, ProjectsModule],
  providers: [
    {
      provide: PostgresSearchProjectionReader,
      useFactory: (client: DatabaseClient) =>
        new PostgresSearchProjectionReader(client.sql),
      inject: [DATABASE_CLIENT],
    },
    SearchCursorService,
    {
      provide: SearchQueryService,
      useFactory: (
        projectAccess: ProjectAccessQueryPort,
        reader: PostgresSearchProjectionReader,
        cursor: SearchCursorService,
      ) => new SearchQueryService(projectAccess, reader, cursor),
      inject: [
        PROJECT_ACCESS_QUERY_PORT,
        PostgresSearchProjectionReader,
        SearchCursorService,
      ],
    },
  ],
  controllers: [SearchController],
})
export class SearchModule {}
