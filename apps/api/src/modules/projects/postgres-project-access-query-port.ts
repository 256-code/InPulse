import { Inject, Injectable } from "@nestjs/common";

import type { DatabaseClient } from "@inpulse/database/client";

import { DATABASE_CLIENT } from "../../database/database.constants.js";
import type {
  AuthorizedProjectScope,
  ProjectAccessQueryPort,
} from "./project-access.port.js";

/**
 * `ProjectAccessQueryPort` 的生产适配器，由 `ProjectsModule` 注入。
 *
 * 每次查询都实时读取用户启用状态、全局管理员标记和活跃成员关系，
 * 不缓存成员关系，也绝不接受客户端提交的项目范围。
 */
@Injectable()
export class PostgresProjectAccessQueryPort implements ProjectAccessQueryPort {
  constructor(
    @Inject(DATABASE_CLIENT)
    private readonly client: DatabaseClient,
  ) {}

  async getAuthorizedSearchScope(
    actorUserId: number,
  ): Promise<AuthorizedProjectScope> {
    const users = (await this.client.sql`
      SELECT is_admin AS "isAdmin", status
        FROM app.users
       WHERE id = ${actorUserId}
    `) as unknown as readonly { isAdmin: boolean; status: string }[];
    const user = users[0];
    if (user === undefined || user.status !== "ACTIVE") {
      return {
        actorUserId,
        projectIds: [],
        isSystemAdmin: false,
      };
    }

    if (user.isAdmin) {
      const projects = (await this.client.sql`
        SELECT id
          FROM app.projects
         ORDER BY id ASC
      `) as unknown as readonly { id: number }[];
      return {
        actorUserId,
        projectIds: projects.map((project) => project.id),
        isSystemAdmin: true,
      };
    }

    const memberships = (await this.client.sql`
      SELECT DISTINCT project_id AS "projectId"
        FROM app.project_members
       WHERE user_id = ${actorUserId}
         AND status = 'ACTIVE'
       ORDER BY project_id ASC
    `) as unknown as readonly { projectId: number }[];
    return {
      actorUserId,
      projectIds: memberships.map((membership) => membership.projectId),
      isSystemAdmin: false,
    };
  }
}
