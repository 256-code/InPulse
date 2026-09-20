import type { ProjectStatus } from "@inpulse/api-contract";

import type { TransactionContext } from "../../database/transaction-context.js";

/**
 * ADR-035 项目生命周期四态：未开始 / 进行中 / 维护中 / 已归档。
 * 新建项目固定从未开始起步，归档只能经归档流程写入。
 */
export type ProjectLifecycleStatus = ProjectStatus;

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
  readonly status: "NOT_STARTED";
  readonly rowVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AddProjectMemberInput {
  readonly projectId: number;
  readonly userId: number;
  /** ADR-033：缺省 MEMBER；创建项目 Workflow 对创建者显式传 LEADER。 */
  readonly role?: "MEMBER" | "PROJECT_ADMIN" | "LEADER";
}

export interface ProjectMemberAddedRecord {
  readonly userId: number;
  readonly status: "ACTIVE" | "REMOVED";
  readonly role: "MEMBER" | "PROJECT_ADMIN" | "LEADER";
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
  /** ADR-033：项目内角色；REMOVED 行恒为 MEMBER。 */
  readonly role: "MEMBER" | "PROJECT_ADMIN" | "LEADER";
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
  readonly status: ProjectLifecycleStatus;
  readonly rowVersion: number;
}

/** 项目变更后的完整公开摘要；与 ProjectItem 对齐，供写操作直接构造响应。 */
export interface ProjectChangeRecord {
  readonly projectId: number;
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly status: ProjectLifecycleStatus;
  /**
   * 粘性标记：项目第一次有任务完成的时间；有值即表示项目已有产出，
   * 服务端禁止把它回退为未开始。
   */
  readonly firstTaskCompletedAt: string | null;
  readonly rowVersion: number;
  readonly createdBy: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly memberCount: number;
  readonly stats: ProjectStatRecord;
}

/**
 * 任务完成后的粘性置位结果；调用方据此判定是否需要写审计、活动与站内通知。
 * previousStatus 非未开始或 status 未变时表示只是补齐标记，无需额外副作用。
 */
export interface ProjectFirstTaskCompletionRecord {
  readonly projectId: number;
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly previousStatus: ProjectLifecycleStatus;
  readonly status: ProjectLifecycleStatus;
  readonly rowVersion: number;
  readonly firstTaskCompletedAt: string;
}

/** 项目卡统计；与 R-2 项目概览的 ProjectOverviewStats 同名同口径。 */
export interface ProjectStatRecord {
  readonly activeModuleCount: number;
  readonly activeFeatureCount: number;
  readonly openTaskCount: number;
  readonly completedTaskCount: number;
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

  /** 读取项目完整摘要；lock 为 true 时对项目行 FOR UPDATE。 */
  abstract findProjectForChange(
    tx: TransactionContext,
    input: { readonly projectId: number },
    lock?: boolean,
  ): Promise<ProjectChangeRecord | undefined>;

  /** 条件更新名称与描述并递增 row_version；版本不匹配返回 undefined。 */
  abstract updateProjectDetails(
    tx: TransactionContext,
    input: {
      readonly projectId: number;
      readonly expectedRowVersion: number;
      readonly name: string;
      readonly description: string;
    },
  ): Promise<ProjectChangeRecord | undefined>;

  /**
   * 条件迁移项目状态并递增 row_version；只有 ARCHIVED 允许 archived_at 非空，
   * 其余三态一律置空，版本不匹配返回 undefined。
   */
  abstract updateProjectStatus(
    tx: TransactionContext,
    input: {
      readonly projectId: number;
      readonly expectedRowVersion: number;
      readonly status: ProjectLifecycleStatus;
    },
  ): Promise<ProjectChangeRecord | undefined>;

  /**
   * 任务完成写路径的粘性置位：first_task_completed_at 取最早一次完成时间且永不回落；
   * 项目当前处于未开始时在同一语句内升级为进行中并递增 row_version。
   *
   * 项目不存在、或已有粘性标记且不再是未开始（本次无需任何变更）都返回 undefined，
   * 由调用方按「没有状态迁移」处理；这也让后续任务完成不会反复推高项目版本。
   */
  abstract recordFirstTaskCompletion(
    tx: TransactionContext,
    input: { readonly projectId: number; readonly completedAt: Date },
  ): Promise<ProjectFirstTaskCompletionRecord | undefined>;

  /** 统计项目当前未完成（TODO 且 ACTIVE）任务数；只读，用于归档提醒。 */
  abstract countUnfinishedTasks(
    tx: TransactionContext,
    input: { readonly projectId: number },
  ): Promise<number>;

  /**
   * ADR-034：统计项目下尚未归档（lifecycle_status 为 ACTIVE）的任务数；
   * 项目归档申请与批准都要求结果为 0。
   */
  abstract countUnarchivedTasks(
    tx: TransactionContext,
    input: { readonly projectId: number },
  ): Promise<number>;

  /** 重新加入/新增 ACTIVE 成员；调用方须先锁定历史并处理活跃冲突。 */
  abstract addMemberHistory(
    tx: TransactionContext,
    input: AddProjectMemberInput,
  ): Promise<ProjectMemberRecord>;

  abstract removeMember(
    tx: TransactionContext,
    input: ProjectMemberIdentity,
  ): Promise<ProjectMemberRecord | undefined>;

  /**
   * ADR-033：条件更新 ACTIVE 成员行角色；目标非 ACTIVE 或不存在返回 undefined。
   * LEADER 唯一性由部分唯一索引保证，冲突由调用方映射 409。
   */
  abstract setMemberRole(
    tx: TransactionContext,
    input: ProjectMemberIdentity & {
      readonly role: "MEMBER" | "PROJECT_ADMIN" | "LEADER";
    },
  ): Promise<ProjectMemberRecord | undefined>;
}

/** 初始成员 ACTIVE 校验；返回合法集合，调用方负责与请求成员比对并决定是否回滚。 */
export abstract class ActiveUsersQueryPort {
  abstract findActiveUserIds(
    tx: TransactionContext,
    userIds: readonly number[],
  ): Promise<readonly number[]>;
}
