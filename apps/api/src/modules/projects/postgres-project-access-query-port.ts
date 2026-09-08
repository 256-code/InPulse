import { Inject, Injectable } from "@nestjs/common";

import type { DatabaseClient } from "@inpulse/database/client";

import type { TransactionContext } from "../../database/transaction-context.js";
import { DATABASE_CLIENT } from "../../database/database.constants.js";
import type {
  AuthorizedProjectScope,
  ProjectAccessQueryPort,
  ProjectForWriteResource,
  ProjectWriteCheckResult,
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

  async checkProjectForWrite(
    tx: TransactionContext,
    input: { readonly actorUserId: number; readonly projectId: number },
  ): Promise<ProjectWriteCheckResult> {
    const users = (await tx.sql`
      SELECT is_admin AS "isAdmin", status
        FROM app.users
       WHERE id = ${input.actorUserId}
    `) as unknown as readonly { isAdmin: boolean; status: string }[];
    const user = users[0];
    if (user === undefined || user.status !== "ACTIVE") {
      return { kind: "not-found" };
    }

    const projects = (await tx.sql`
      SELECT id,
             status,
             row_version AS "rowVersion"
        FROM app.projects
       WHERE id = ${input.projectId}
       FOR SHARE
    `) as unknown as readonly {
      id: number;
      status: string;
      rowVersion: number;
    }[];
    const project = projects[0];
    if (project === undefined) {
      return { kind: "not-found" };
    }

    if (user.isAdmin) {
      return this.toWriteCheckResult(project, true);
    }

    const memberships = (await tx.sql`
      SELECT 1 AS "matched"
        FROM app.project_members
       WHERE project_id = ${input.projectId}
         AND user_id = ${input.actorUserId}
         AND status = 'ACTIVE'
       LIMIT 1
    `) as unknown as readonly { matched: number }[];
    if (memberships[0] === undefined) {
      return { kind: "not-found" };
    }

    return this.toWriteCheckResult(project, false);
  }

  private toWriteCheckResult(
    project: {
      readonly id: number;
      readonly status: string;
      readonly rowVersion: number;
    },
    isSystemAdmin: boolean,
  ): ProjectWriteCheckResult {
    const resource: ProjectForWriteResource = {
      projectId: project.id,
      status: project.status === "ARCHIVED" ? "ARCHIVED" : "ACTIVE",
      rowVersion: project.rowVersion,
      isSystemAdmin,
    };
    return resource.status === "ACTIVE"
      ? { kind: "allowed", resource }
      : { kind: "parent-not-active", resource };
  }
}
