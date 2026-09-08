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
}

/** 初始成员 ACTIVE 校验；返回合法集合，调用方负责与请求成员比对并决定是否回滚。 */
export abstract class ActiveUsersQueryPort {
  abstract findActiveUserIds(
    tx: TransactionContext,
    userIds: readonly number[],
  ): Promise<readonly number[]>;
}
