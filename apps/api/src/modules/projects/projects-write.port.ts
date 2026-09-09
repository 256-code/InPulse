import type { TransactionContext } from "../../database/transaction-context.js";

/** 项目创建输入；创建者由调用方（Workflow）从认证 Session 解析并显式传入。 */
export interface CreateProjectRecordInput {
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly createdBy: number;
}

export interface ProjectCreatedRecord {
  readonly projectId: number;
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly createdBy: number;
  readonly status: "ACTIVE";
  readonly rowVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AddProjectMemberInput {
  readonly projectId: number;
  readonly userId: number;
}

export interface ProjectMemberAddedRecord {
  readonly userId: number;
  readonly status: "ACTIVE" | "REMOVED";
  readonly joinedAt: string;
}

/** 成员管理完整历史记录；名称与头像仅用于管理员展示与成员列表，不包含账号敏感字段。 */
export interface ProjectMemberRecord {
  readonly membershipId: number;
  readonly projectId: number;
  readonly userId: number;
  readonly name: string;
  readonly avatarUrl: string | null;
  readonly status: "ACTIVE" | "REMOVED";
  readonly joinedAt: string;
  readonly removedAt: string | null;
}

export interface ProjectMemberIdentity {
  readonly projectId: number;
  readonly userId: number;
}

/** 项目存在性/只读摘要；供事务内成员管理命令验证目标项目。 */
export interface ProjectRecord {
  readonly projectId: number;
  readonly name: string;
  readonly status: "ACTIVE" | "ARCHIVED";
  readonly rowVersion: number;
}

/** 项目与成员写边界；只做持久化，不决定业务状态流转，调用方持有事务。 */
export abstract class ProjectsWritePort {
  abstract createProject(
    tx: TransactionContext,
    input: CreateProjectRecordInput,
  ): Promise<ProjectCreatedRecord>;

  abstract addMember(
    tx: TransactionContext,
    input: AddProjectMemberInput,
  ): Promise<ProjectMemberAddedRecord>;

  abstract listMembers(
    tx: TransactionContext,
    input: { readonly projectId: number },
  ): Promise<ProjectMemberRecord[]>;

  abstract findLatestMember(
    tx: TransactionContext,
    input: ProjectMemberIdentity,
    lock?: boolean,
  ): Promise<ProjectMemberRecord | undefined>;

  abstract findProject(
    tx: TransactionContext,
    input: { readonly projectId: number },
  ): Promise<ProjectRecord | undefined>;

  /** 重新加入/新增 ACTIVE 成员；调用方须先锁定历史并处理活跃冲突。 */
  abstract addMemberHistory(
    tx: TransactionContext,
    input: AddProjectMemberInput,
  ): Promise<ProjectMemberRecord>;

  abstract removeMember(
    tx: TransactionContext,
    input: ProjectMemberIdentity,
  ): Promise<ProjectMemberRecord | undefined>;
}

/** 初始成员 ACTIVE 校验；返回合法集合，调用方负责与请求成员比对并决定是否回滚。 */
export abstract class ActiveUsersQueryPort {
  abstract findActiveUserIds(
    tx: TransactionContext,
    userIds: readonly number[],
  ): Promise<readonly number[]>;
}
