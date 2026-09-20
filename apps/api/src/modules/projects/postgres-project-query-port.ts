import { Inject, Injectable } from "@nestjs/common";
import type {
  ProjectItem,
  ProjectListItem,
  ProjectStatus,
} from "@inpulse/api-contract";
import type { DatabaseClient } from "@inpulse/database/client";
import { DATABASE_CLIENT } from "../../database/database.constants.js";
import {
  projectLifecycleRankExpression,
  projectStatColumns,
} from "../../stats/card-stat-columns.js";
import { ProjectQueryPort } from "./project-query.port.js";

interface ProjectListItemRow {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly status: ProjectStatus;
  readonly rowVersion: number;
  readonly createdBy: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly firstTaskCompletedAt: Date | null;
  readonly memberCount: number;
  readonly activeModuleCount: number;
  readonly activeFeatureCount: number;
  readonly openTaskCount: number;
  readonly completedTaskCount: number;
  readonly currentUserRole: "MEMBER" | "PROJECT_ADMIN" | "LEADER" | null;
  readonly pendingRequestId: number | null;
  readonly pendingRequestedBy: number | null;
  readonly pendingRequestedByName: string | null;
  readonly pendingReason: string | null;
  readonly pendingRequestedAt: Date | null;
}

interface ProjectRow {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly status: ProjectStatus;
  readonly rowVersion: number;
  readonly createdBy: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly firstTaskCompletedAt: Date | null;
  readonly memberCount: number;
  readonly activeModuleCount: number;
  readonly activeFeatureCount: number;
  readonly openTaskCount: number;
  readonly completedTaskCount: number;
}

/**
 * 项目只读 PostgreSQL 适配器；不计入事务，在服务端授权范围之后执行。
 * ADR-035：状态读存储四态，粘性标记 first_task_completed_at 只下发给前端一个布尔位。
 */
@Injectable()
export class PostgresProjectQueryPort extends ProjectQueryPort {
  constructor(
    @Inject(DATABASE_CLIENT)
    private readonly client: DatabaseClient,
  ) {
    super();
  }

  async list(
    projectIds: readonly number[],
    actorUserId?: number,
  ): Promise<readonly ProjectListItem[]> {
    if (projectIds.length === 0) {
      return [];
    }
    const rows = (await this.client.sql`
      SELECT p.id,
             p.code,
             p.name,
             p.description,
             p.status,
             p.row_version AS "rowVersion",
             p.created_by AS "createdBy",
             p.created_at AS "createdAt",
             p.updated_at AS "updatedAt",
             p.first_task_completed_at AS "firstTaskCompletedAt",
             (
               SELECT COUNT(*)::integer
                 FROM app.project_members m
                WHERE m.project_id = p.id
                  AND m.status = 'ACTIVE'
             ) AS "memberCount",
             ${projectStatColumns(this.client.sql, "p")},
             m.role AS "currentUserRole",
             r.id AS "pendingRequestId",
             r.requested_by AS "pendingRequestedBy",
             requester.name AS "pendingRequestedByName",
             r.reason AS "pendingReason",
             r.requested_at AS "pendingRequestedAt"
        FROM app.projects p
        LEFT JOIN app.project_members m
               ON m.project_id = p.id
              AND m.user_id = ${actorUserId ?? null}
              AND m.status = 'ACTIVE'
        LEFT JOIN app.project_archive_requests r
               ON r.project_id = p.id
              AND r.status = 'PENDING'
        LEFT JOIN app.users requester ON requester.id = r.requested_by
       WHERE p.id = ANY(${projectIds}::integer[])
       ORDER BY ${projectLifecycleRankExpression(this.client.sql, "p")}, p.id ASC
    `) as unknown as readonly ProjectListItemRow[];
    return rows.map((row) => this.toListItem(row));
  }

  async findActiveMemberRole(
    projectId: number,
    userId: number,
  ): Promise<"MEMBER" | "PROJECT_ADMIN" | "LEADER" | null> {
    const rows = (await this.client.sql`
      SELECT role
        FROM app.project_members
       WHERE project_id = ${projectId}
         AND user_id = ${userId}
         AND status = 'ACTIVE'
       LIMIT 1
    `) as unknown as readonly {
      role: "MEMBER" | "PROJECT_ADMIN" | "LEADER";
    }[];
    return rows[0]?.role ?? null;
  }

  async find(projectId: number): Promise<ProjectItem | undefined> {
    const rows = (await this.client.sql`
      SELECT p.id,
             p.code,
             p.name,
             p.description,
             p.status,
             p.row_version AS "rowVersion",
             p.created_by AS "createdBy",
             p.created_at AS "createdAt",
             p.updated_at AS "updatedAt",
             p.first_task_completed_at AS "firstTaskCompletedAt",
             (
               SELECT COUNT(*)::integer
                 FROM app.project_members m
                WHERE m.project_id = p.id
                  AND m.status = 'ACTIVE'
             ) AS "memberCount",
             ${projectStatColumns(this.client.sql, "p")}
        FROM app.projects p
       WHERE p.id = ${projectId}
    `) as unknown as readonly ProjectRow[];
    const row = rows[0];
    return row === undefined ? undefined : this.toItem(row);
  }

  private toListItem(row: ProjectListItemRow): ProjectListItem {
    return {
      ...this.toItem(row),
      currentUserRole: row.currentUserRole,
      pendingArchiveRequest:
        row.pendingRequestId === null ||
        row.pendingRequestedBy === null ||
        row.pendingRequestedByName === null ||
        row.pendingReason === null ||
        row.pendingRequestedAt === null
          ? null
          : {
              id: row.pendingRequestId,
              requestedBy: row.pendingRequestedBy,
              requestedByName: row.pendingRequestedByName,
              reason: row.pendingReason,
              requestedAt: new Date(row.pendingRequestedAt).toISOString(),
            },
    };
  }

  private toItem(row: ProjectRow): ProjectItem {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description,
      status: row.status,
      hasCompletedTask: row.firstTaskCompletedAt !== null,
      rowVersion: row.rowVersion,
      createdBy: row.createdBy,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
      memberCount: row.memberCount,
      stats: {
        activeModuleCount: row.activeModuleCount,
        activeFeatureCount: row.activeFeatureCount,
        openTaskCount: row.openTaskCount,
        completedTaskCount: row.completedTaskCount,
      },
    };
  }
}
