import type { TransactionContext } from "../../database/transaction-context.js";
import type { ProjectLifecycleStatus } from "./projects-write.port.js";

export const PROJECT_ACCESS_QUERY_PORT = Symbol("PROJECT_ACCESS_QUERY_PORT");

/**
 * Server-generated authorization result. Consumers must never construct this
 * value from client input. The production provider belongs to ProjectsModule
 * and is expected to read member history and the global admin flag on every
 * request.
 */
export interface AuthorizedProjectScope {
  readonly actorUserId: number;
  readonly projectIds: readonly number[];
  readonly isSystemAdmin: boolean;
}

export interface ProjectForWriteResource {
  readonly projectId: number;
  readonly status: ProjectLifecycleStatus;
  readonly rowVersion: number;
  readonly isSystemAdmin: boolean;
}

/**
 * 与 B 侧 Module/Feature 的 `WriteCheckResult` 保持同一语义：
 * - `not-found`：项目不存在、当前用户停用，或普通用户没有 ACTIVE 成员关系。
 * - `parent-not-active`：已通过归属/成员校验，但项目已归档（status = ARCHIVED）。
 *   项目四态改造后只有「已归档」拦截写入：未开始 / 进行中 / 维护中都是活跃态，
 *   仍可新建模块、功能、任务与记录；「维护中」只是对外声明的纯标签。
 * Port 只返回类型化结果，不抛出 HTTP 异常；HTTP 映射由 Use Case/Workflow 负责。
 */
export type ProjectWriteCheckResult =
  | { kind: "allowed"; resource: ProjectForWriteResource }
  | { kind: "not-found" }
  | { kind: "parent-not-active"; resource: ProjectForWriteResource };

export interface ProjectAccessQueryPort {
  getAuthorizedSearchScope(
    actorUserId: number,
  ): Promise<AuthorizedProjectScope>;

  checkProjectForWrite(
    tx: TransactionContext,
    input: { readonly actorUserId: number; readonly projectId: number },
  ): Promise<ProjectWriteCheckResult>;
}
