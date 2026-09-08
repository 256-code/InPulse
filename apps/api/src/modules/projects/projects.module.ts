import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../database/database.module.js";
import { PostgresProjectAccessQueryPort } from "./postgres-project-access-query-port.js";
import { PROJECT_ACCESS_QUERY_PORT } from "./project-access.port.js";

/**
 * 项目与项目成员模块。
 *
 * 当前阶段只提供 `ProjectAccessQueryPort` 生产适配器；下游 Search/Activity
 * 查询服务只能通过该 token 取得服务端生成的 AuthorizedProjectScope。
 */
@Module({
  imports: [DatabaseModule],
  providers: [
    PostgresProjectAccessQueryPort,
    {
      provide: PROJECT_ACCESS_QUERY_PORT,
      useExisting: PostgresProjectAccessQueryPort,
    },
  ],
  exports: [PROJECT_ACCESS_QUERY_PORT],
})
export class ProjectsModule {}
