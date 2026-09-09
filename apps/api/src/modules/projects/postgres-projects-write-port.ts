import type { TransactionContext } from "../../database/transaction-context.js";
import {
  ActiveUsersQueryPort,
  type AddProjectMemberInput,
  type CreateProjectRecordInput,
  type ProjectCreatedRecord,
  type ProjectMemberAddedRecord,
  ProjectsWritePort,
} from "./projects-write.port.js";

interface ProjectInsertRow {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly created_by: number;
  readonly status: "ACTIVE";
  readonly row_version: number;
  readonly created_at: Date;
  readonly updated_at: Date;
}

interface MemberInsertRow {
  readonly user_id: number;
  readonly status: "ACTIVE" | "REMOVED";
  readonly joined_at: Date;
}

/** 项目写适配器；只接收显式 TransactionContext，从不开启事务或使用全局客户端。 */
export class PostgresProjectsWritePort extends ProjectsWritePort {
  async createProject(
    tx: TransactionContext,
    input: CreateProjectRecordInput,
  ): Promise<ProjectCreatedRecord> {
    const rows = (await tx.sql`
      INSERT INTO app.projects (code, name, description, created_by)
      VALUES (${input.code}, ${input.name}, ${input.description}, ${input.createdBy})
      RETURNING id,
                code,
                name,
                description,
                created_by,
                status,
                row_version,
                created_at,
                updated_at
    `) as unknown as readonly ProjectInsertRow[];
    const row = rows[0];
    if (row === undefined) {
      throw new Error("Project insert returned no row");
    }
    return {
      projectId: row.id,
      code: row.code,
      name: row.name,
      description: row.description,
      createdBy: row.created_by,
      status: row.status,
      rowVersion: row.row_version,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  async addMember(
    tx: TransactionContext,
    input: AddProjectMemberInput,
  ): Promise<ProjectMemberAddedRecord> {
    const rows = (await tx.sql`
      INSERT INTO app.project_members (project_id, user_id)
      VALUES (${input.projectId}, ${input.userId})
      RETURNING user_id, status, joined_at
    `) as unknown as readonly MemberInsertRow[];
    const row = rows[0];
    if (row === undefined) {
      throw new Error("Project member insert returned no row");
    }
    return {
      userId: row.user_id,
      status: row.status,
      joinedAt: new Date(row.joined_at).toISOString(),
    };
  }
}

/** 初始成员 ACTIVE 校验；只读取，不决定业务流转。 */
export class PostgresActiveUsersQueryPort extends ActiveUsersQueryPort {
  async findActiveUserIds(
    tx: TransactionContext,
    userIds: readonly number[],
  ): Promise<readonly number[]> {
    if (userIds.length === 0) {
      return [];
    }
    const rows = (await tx.sql`
      SELECT id
        FROM app.users
       WHERE id = ANY(${userIds}::integer[])
         AND status = 'ACTIVE'
         AND disabled_at IS NULL
       ORDER BY id ASC
    `) as unknown as readonly { id: number }[];
    return rows.map((row) => row.id);
  }
}
