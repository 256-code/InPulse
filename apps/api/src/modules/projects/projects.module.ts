import {
  ProjectLinkQueryPort,
  ProjectLinkCommandPort,
} from "./external-link-target.port.js";
import { ProjectCodePort } from "./project-code.port.js";
import { ProjectMembersQueryPort } from "./project-members-query.port.js";
import { PostgresProjectMembersQueryPort } from "./postgres-project-members-query-port.js";
import { PostgresProjectCodePort } from "./postgres-project-code-port.js";
import { PostgresProjectQueryPort } from "./postgres-project-query-port.js";
import { ProjectQueryPort } from "./project-query.port.js";
import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../database/database.module.js";
import { PostgresProjectAccessQueryPort } from "./postgres-project-access-query-port.js";
import { PROJECT_ACCESS_QUERY_PORT } from "./project-access.port.js";
import {
  ActiveUsersQueryPort,
  ProjectsWritePort,
} from "./projects-write.port.js";
import {
  PostgresActiveUsersQueryPort,
  PostgresProjectsWritePort,
} from "./postgres-projects-write-port.js";

/**
 * 项目与项目成员模块。
 *
 * 提供 `ProjectAccessQueryPort` 只读适配器与项目创建写端口；下游 Search/Activity
 * 查询服务只能通过该 token 取得服务端生成的 AuthorizedProjectScope。
 */
@Module({
  imports: [DatabaseModule],
  providers: [
    ProjectLinkQueryPort,
    ProjectLinkCommandPort,
    {
      provide: ProjectMembersQueryPort,
      useClass: PostgresProjectMembersQueryPort,
    },
    { provide: ProjectCodePort, useClass: PostgresProjectCodePort },
    { provide: ProjectQueryPort, useClass: PostgresProjectQueryPort },
    PostgresProjectAccessQueryPort,
    {
      provide: PROJECT_ACCESS_QUERY_PORT,
      useExisting: PostgresProjectAccessQueryPort,
    },
    {
      provide: ProjectsWritePort,
      useClass: PostgresProjectsWritePort,
    },
    {
      provide: ActiveUsersQueryPort,
      useClass: PostgresActiveUsersQueryPort,
    },
  ],
  exports: [
    ProjectLinkQueryPort,
    ProjectLinkCommandPort,
    ProjectMembersQueryPort,
    ProjectCodePort,
    ProjectQueryPort,
    PROJECT_ACCESS_QUERY_PORT,
    ProjectsWritePort,
    ActiveUsersQueryPort,
  ],
})
export class ProjectsModule {}
