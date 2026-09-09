import type { TransactionContext } from "../../database/transaction-context.js";
import {
  ActiveUsersQueryPort,
  type AddProjectMemberInput,
  type CreateProjectRecordInput,
  type ProjectCreatedRecord,
  type ProjectMemberAddedRecord,
  type ProjectMemberIdentity,
  type ProjectMemberRecord,
  type ProjectRecord,
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

interface MemberRow {
  readonly membership_id: number;
  readonly project_id: number;
  readonly user_id: number;
  readonly name: string;
  readonly avatar_url: string | null;
  readonly status: "ACTIVE" | "REMOVED";
  readonly joined_at: Date;
  readonly removed_at: Date | null;
}

interface ProjectSummaryRow {
  readonly id: number;
  readonly name: string;
  readonly status: "ACTIVE" | "ARCHIVED";
  readonly row_version: number;
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

  async listMembers(
    tx: TransactionContext,
    input: { readonly projectId: number },
  ): Promise<ProjectMemberRecord[]> {
    const rows = (await tx.sql`
      SELECT pm.id AS "membership_id",
             pm.project_id,
             pm.user_id,
             u.name,
             u.avatar_url,
             pm.status,
             pm.joined_at,
             pm.removed_at
        FROM app.project_members AS pm
        JOIN app.users AS u ON u.id = pm.user_id
       WHERE pm.project_id = ${input.projectId}
       ORDER BY pm.joined_at ASC, pm.id ASC
    `) as unknown as readonly MemberRow[];
    return rows.map((row) => this.toRecord(row));
  }

  async findProject(
    tx: TransactionContext,
    input: { readonly projectId: number },
  ): Promise<ProjectRecord | undefined> {
    const rows = (await tx.sql`
      SELECT id,
             name,
             status,
             row_version
        FROM app.projects
       WHERE id = ${input.projectId}
       LIMIT 1
    `) as unknown as readonly ProjectSummaryRow[];
    const row = rows[0];
    return row === undefined
      ? undefined
      : {
          projectId: row.id,
          name: row.name,
          status: row.status,
          rowVersion: row.row_version,
        };
  }

  async findLatestMember(
    tx: TransactionContext,
    input: ProjectMemberIdentity,
    lock = false,
  ): Promise<ProjectMemberRecord | undefined> {
    const rows = (await tx.sql`
      SELECT pm.id AS "membership_id",
             pm.project_id,
             pm.user_id,
             u.name,
             u.avatar_url,
             pm.status,
             pm.joined_at,
             pm.removed_at
        FROM app.project_members AS pm
        JOIN app.users AS u ON u.id = pm.user_id
       WHERE pm.project_id = ${input.projectId}
         AND pm.user_id = ${input.userId}
       ORDER BY pm.joined_at DESC, pm.id DESC
       LIMIT 1
       ${lock ? tx.sql`FOR UPDATE OF pm` : tx.sql``}
    `) as unknown as readonly MemberRow[];
    const row = rows[0];
    return row === undefined ? undefined : this.toRecord(row);
  }

  async addMemberHistory(
    tx: TransactionContext,
    input: AddProjectMemberInput,
  ): Promise<ProjectMemberRecord> {
    const inserted = (await tx.sql`
      INSERT INTO app.project_members (project_id, user_id)
      VALUES (${input.projectId}, ${input.userId})
      RETURNING id
    `) as unknown as readonly { id: number }[];
    if (inserted.length === 0) {
      throw new Error("Project member history insert returned no row");
    }
    const record = await this.findLatestMember(tx, input);
    if (record === undefined) {
      throw new Error("Project member history insert could not be reloaded");
    }
    return record;
  }

  async removeMember(
    tx: TransactionContext,
    input: ProjectMemberIdentity,
  ): Promise<ProjectMemberRecord | undefined> {
    const current = await this.findLatestMember(tx, input, true);
    if (current === undefined || current.status !== "ACTIVE") {
      return undefined;
    }
    const updated = (await tx.sql`
      UPDATE app.project_members
         SET status = 'REMOVED',
             removed_at = now()
       WHERE id = ${current.membershipId}
         AND status = 'ACTIVE'
      RETURNING id
    `) as unknown as readonly { id: number }[];
    if (updated.length === 0) {
      return undefined;
    }
    return this.findLatestMember(tx, input);
  }

  private toRecord(row: MemberRow): ProjectMemberRecord {
    return {
      membershipId: row.membership_id,
      projectId: row.project_id,
      userId: row.user_id,
      name: row.name,
      avatarUrl: row.avatar_url,
      status: row.status,
      joinedAt: new Date(row.joined_at).toISOString(),
      removedAt:
        row.removed_at === null ? null : new Date(row.removed_at).toISOString(),
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
