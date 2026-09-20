import type { TransactionContext } from "../../database/transaction-context.js";

/** 项目归档申请状态；与 database/migrations/0016 的 CHECK 约束一致。 */
export type ProjectArchiveRequestStatus =
  "PENDING" | "APPROVED" | "REJECTED" | "CANCELED";

/**
 * 归档申请完整记录；申请人与审核人只携带展示名，
 * 不包含登录名、邮箱或其他账号敏感字段。
 */
export interface ProjectArchiveRequestRecord {
  readonly requestId: number;
  readonly projectId: number;
  readonly requestedBy: number;
  readonly requestedByName: string;
  readonly reason: string;
  readonly status: ProjectArchiveRequestStatus;
  readonly requestedAt: string;
  readonly decidedBy: number | null;
  readonly decidedByName: string | null;
  readonly decidedAt: string | null;
  readonly decisionNote: string | null;
  readonly rowVersion: number;
}

/** 项目列表条目上的待审申请摘要（ADR-034）。 */
export interface PendingProjectArchiveRequestSummary {
  readonly projectId: number;
  readonly requestId: number;
  readonly requestedBy: number;
  readonly requestedByName: string;
  readonly reason: string;
  readonly requestedAt: string;
}

/**
 * 项目归档申请写/读边界：只做持久化，不决定状态流转；
 * 调用方持有事务并负责审计、活动与通知。
 */
export abstract class ProjectArchiveRequestPort {
  /**
   * 插入待审申请；同一项目已有待审申请时唯一索引冲突被吞掉并返回
   * undefined，调用方映射 409，不依赖进程内锁。
   */
  abstract insertRequest(
    tx: TransactionContext,
    input: {
      readonly projectId: number;
      readonly requestedBy: number;
      readonly reason: string;
    },
  ): Promise<ProjectArchiveRequestRecord | undefined>;

  /** 读取单条申请；lock 为 true 时对申请行 FOR UPDATE。 */
  abstract findRequest(
    tx: TransactionContext,
    input: { readonly projectId: number; readonly requestId: number },
    lock?: boolean,
  ): Promise<ProjectArchiveRequestRecord | undefined>;

  /**
   * 条件更新决定列并递增 row_version；只有仍为 PENDING 且版本匹配的
   * 行会被更新，否则返回 undefined。
   */
  abstract decideRequest(
    tx: TransactionContext,
    input: {
      readonly projectId: number;
      readonly requestId: number;
      readonly status: "APPROVED" | "REJECTED" | "CANCELED";
      readonly decidedBy: number;
      readonly decisionNote: string | null;
      readonly expectedRowVersion: number;
    },
  ): Promise<ProjectArchiveRequestRecord | undefined>;

  /** 项目被直接归档时结束仍待审的申请；返回被取消的申请 ID。 */
  abstract cancelPendingRequests(
    tx: TransactionContext,
    input: { readonly projectId: number; readonly decidedBy: number },
  ): Promise<readonly number[]>;

  /** 项目列表附带待审申请摘要；只返回给定项目范围内的 PENDING 行。 */
  abstract listPendingSummaries(
    tx: TransactionContext,
    projectIds: readonly number[],
  ): Promise<readonly PendingProjectArchiveRequestSummary[]>;

  /**
   * 申请通知接收方：当前可用的系统管理员（ACTIVE 且未停用）。
   * 接收方由服务端场景决定，Port 不接受客户端传入的 recipient。
   */
  abstract listActiveAdminIds(
    tx: TransactionContext,
  ): Promise<readonly number[]>;
}
