import { Inject, Injectable } from "@nestjs/common";
import type { ProjectItem } from "@inpulse/api-contract";
import type { DatabaseClient } from "@inpulse/database/client";
import { DATABASE_CLIENT } from "../../database/database.constants.js";
import { ProjectQueryPort } from "./project-query.port.js";

interface ProjectRow {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly status: string;
  readonly rowVersion: number;
  readonly createdBy: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly memberCount: number;
}

/** 项目只读 PostgreSQL 适配器；不计入事务，在服务端授权范围之后执行。 */
@Injectable()
export class PostgresProjectQueryPort extends ProjectQueryPort {
  constructor(
    @Inject(DATABASE_CLIENT)
    private readonly client: DatabaseClient,
  ) {
    super();
  }

  async list(projectIds: readonly number[]): Promise<readonly ProjectItem[]> {
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
             (
               SELECT COUNT(*)::integer
                 FROM app.project_members m
                WHERE m.project_id = p.id
                  AND m.status = 'ACTIVE'
             ) AS "memberCount"
        FROM app.projects p
       WHERE p.id = ANY(${projectIds}::integer[])
       ORDER BY p.id ASC
    `) as unknown as readonly ProjectRow[];
    return rows.map((row) => this.toItem(row));
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
             (
               SELECT COUNT(*)::integer
                 FROM app.project_members m
                WHERE m.project_id = p.id
                  AND m.status = 'ACTIVE'
             ) AS "memberCount"
        FROM app.projects p
       WHERE p.id = ${projectId}
    `) as unknown as readonly ProjectRow[];
    const row = rows[0];
    return row === undefined ? undefined : this.toItem(row);
  }

  private toItem(row: ProjectRow): ProjectItem {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description,
      status: row.status === "ARCHIVED" ? "ARCHIVED" : "ACTIVE",
      rowVersion: row.rowVersion,
      createdBy: row.createdBy,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
      memberCount: row.memberCount,
    };
  }
}
