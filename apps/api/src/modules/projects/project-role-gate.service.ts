import { Inject, Injectable } from "@nestjs/common";

import type { TransactionContext } from "../../database/transaction-context.js";
import {
  PROJECT_ACCESS_QUERY_PORT,
  type ProjectAccessQueryPort,
} from "./project-access.port.js";
import { ProjectMembersQueryPort } from "./project-members-query.port.js";

/**
 * ADR-039：项目内管理操作（成员增删、项目状态变更）对全体活跃成员开放，
 * `LEADER` 只是身份标识，不再单独授予管理权；
 * 例外只有五处：ADR-053 组长可以转移组长身份（`roleSetterRole`），
 * ADR-049 只有组长与系统管理员可以删除项目（`projectDeleterRole`），
 * ADR-051 同口径的还原（`projectRestorerRole`）与只有系统管理员的彻底删除
 * （`projectPurgerRole`），ADR-059 只有组长与系统管理员可以删除模块与功能
 * （`scopeDeleterRole`）。
 */
export type ProjectManageRole = "SYSTEM_ADMIN" | "MEMBER" | "LEADER";

/**
 * ADR-039 项目内角色门禁：只读实时成员关系与全局管理员标记，不缓存进
 * Session。返回类型化结果，HTTP/Use Case 负责映射 403/404：
 * - `NOT_MEMBER`：非本项目活跃成员（含已移除），调用方按资源不存在 404；
 * - 其余（含 `MEMBER`）均放行，调用方只需排除 `NOT_MEMBER`。
 */
export type ProjectRoleGateResult = ProjectManageRole | "NOT_MEMBER";

@Injectable()
export class ProjectRoleGateService {
  constructor(
    @Inject(PROJECT_ACCESS_QUERY_PORT)
    private readonly access: ProjectAccessQueryPort,
    @Inject(ProjectMembersQueryPort)
    private readonly members: ProjectMembersQueryPort,
  ) {}

  async manageRole(
    tx: TransactionContext,
    actorUserId: number,
    projectId: number,
  ): Promise<ProjectRoleGateResult> {
    const scope = await this.access.getAuthorizedSearchScope(actorUserId);
    if (scope.isSystemAdmin) return "SYSTEM_ADMIN";
    if (!scope.projectIds.includes(projectId)) return "NOT_MEMBER";
    const role = await this.members.findActiveRole(tx, {
      projectId,
      userId: actorUserId,
    });
    return role ?? "NOT_MEMBER";
  }

  /**
   * ADR-053 角色任命门禁：与 `manageRole` 同源但口径更窄，只有系统管理员与
   * 本项目组长放行（组长只能把其他活跃成员设为组长完成转移，目标与角色约束
   * 由调用方校验），本项目普通成员归入 `MEMBER`（403），非成员归入
   * `NOT_MEMBER`（404）。单独成方法是为了防止以后有人拿 `manageRole` 放行成员
   * 自行改角色。
   */
  async roleSetterRole(
    tx: TransactionContext,
    actorUserId: number,
    projectId: number,
  ): Promise<"SYSTEM_ADMIN" | "LEADER" | "MEMBER" | "NOT_MEMBER"> {
    const role = await this.manageRole(tx, actorUserId, projectId);
    if (role === "SYSTEM_ADMIN" || role === "LEADER") return role;
    if (role === "NOT_MEMBER") return "NOT_MEMBER";
    return "MEMBER";
  }

  /**
   * ADR-049 项目删除门禁：只有系统管理员与本项目组长放行，本项目普通成员
   * 归入 `MEMBER`（403 PROJECT_DELETE_FORBIDDEN），非成员归入 `NOT_MEMBER`
   * （404）。与 `roleSetterRole` 同源但语义不同，单独成方法，避免删除权限
   * 被未来的「成员可管理」改动顺带放大。
   */
  async projectDeleterRole(
    tx: TransactionContext,
    actorUserId: number,
    projectId: number,
  ): Promise<"SYSTEM_ADMIN" | "LEADER" | "MEMBER" | "NOT_MEMBER"> {
    const role = await this.manageRole(tx, actorUserId, projectId);
    if (role === "SYSTEM_ADMIN" || role === "LEADER") return role;
    if (role === "NOT_MEMBER") return "NOT_MEMBER";
    return "MEMBER";
  }

  /**
   * ADR-049 删除重放门禁（`projectDeleteReplayAuthorizer`）：项目删除后
   * `manageRole` 的授权范围必然查不到该项目而一律返回 `NOT_MEMBER`，重放会
   * 由 204 变成 404。本方法因此只看**保留**的成员关系与全局管理员标记
   * （不过滤 `deleted_at`），复核「如果项目还在，这个人当初还能不能删」：
   * 组长被转移/移除或降级为普通成员后重放一律拒绝，系统管理员保持放行。
   * 当前认证（Session 有效、用户未被停用）由 HTTP 层在调用前完成。
   */
  async projectDeleterReplayRole(
    tx: TransactionContext,
    actorUserId: number,
    projectId: number,
  ): Promise<"SYSTEM_ADMIN" | "LEADER" | "MEMBER" | "NOT_MEMBER"> {
    const scope = await this.access.getAuthorizedSearchScope(actorUserId);
    if (scope.isSystemAdmin) return "SYSTEM_ADMIN";
    const role = await this.members.findActiveRole(tx, {
      projectId,
      userId: actorUserId,
    });
    if (role === "LEADER") return "LEADER";
    return role === undefined ? "NOT_MEMBER" : "MEMBER";
  }

  /**
   * ADR-051 项目还原门禁：与 `projectDeleterRole` 同一口径（系统管理员与本项目
   * 组长），但读的是**保留**的成员关系——还原发生时项目仍处于已删除状态，
   * `manageRole` 的授权范围必然查不到它。与删除重放门禁的关系：两者判定依据
   * 相同，但一个服务于「还没成功执行」的首次请求，另一个服务于「已经成功执行」
   * 的重放；分开命名是为了让后续任何一侧的口径调整都不会静默影响另一侧。
   */
  async projectRestorerRole(
    tx: TransactionContext,
    actorUserId: number,
    projectId: number,
  ): Promise<"SYSTEM_ADMIN" | "LEADER" | "MEMBER" | "NOT_MEMBER"> {
    const scope = await this.access.getAuthorizedSearchScope(actorUserId);
    if (scope.isSystemAdmin) return "SYSTEM_ADMIN";
    const role = await this.members.findActiveRole(tx, {
      projectId,
      userId: actorUserId,
    });
    if (role === "LEADER") return "LEADER";
    return role === undefined ? "NOT_MEMBER" : "MEMBER";
  }

  /**
   * ADR-051 彻底删除门禁：只有系统管理员放行（含项目组长在内的其余身份一律
   * 403 PROJECT_PURGE_FORBIDDEN）。这里刻意不返回 `LEADER`/`MEMBER`：物理删除
   * 不可撤销，与删除/还原的项目内授权不是同一档权力，因此不复用
   * `projectDeleterRole`，避免以后调整删除口径时把彻底删除一并放开。
   */
  async projectPurgerRole(
    actorUserId: number,
  ): Promise<"SYSTEM_ADMIN" | "FORBIDDEN"> {
    const scope = await this.access.getAuthorizedSearchScope(actorUserId);
    return scope.isSystemAdmin ? "SYSTEM_ADMIN" : "FORBIDDEN";
  }

  /**
   * ADR-051 彻底删除重放门禁（`projectPurgeReplayAuthorizer`）：项目行与其审计链
   * 已被物理删除，无法再复核任何项目内资源可读性，因此只复核「当前 Session 仍然
   * 是有效的系统管理员」，与首次执行的门禁同源。当前认证（Session 有效、用户
   * 未被停用）由 HTTP 层在调用前完成。
   */
  async projectPurgeReplayRole(
    actorUserId: number,
  ): Promise<"SYSTEM_ADMIN" | "FORBIDDEN"> {
    return this.projectPurgerRole(actorUserId);
  }

  /**
   * ADR-059 模块与功能删除门禁：只有系统管理员与本项目组长放行，本项目普通成员
   * 归入 `MEMBER`（403 `MODULE_DELETE_FORBIDDEN` / `FEATURE_DELETE_FORBIDDEN`），
   * 非成员（含已移除）归入 `NOT_MEMBER`（404，不泄露存在性）。这里单独成方法而
   * 不复用 `projectDeleterRole`：删除模块/功能会级联删除其功能、任务与迭代记录，
   * 与删除整个项目是两档不同的授权面，任何一侧调整都不应静默影响另一侧。
   */
  async scopeDeleterRole(
    tx: TransactionContext,
    actorUserId: number,
    projectId: number,
  ): Promise<"SYSTEM_ADMIN" | "LEADER" | "MEMBER" | "NOT_MEMBER"> {
    const role = await this.manageRole(tx, actorUserId, projectId);
    if (role === "SYSTEM_ADMIN" || role === "LEADER") return role;
    if (role === "NOT_MEMBER") return "NOT_MEMBER";
    return "MEMBER";
  }

  /**
   * ADR-059 删除重放门禁（`moduleDeleteReplayAuthorizer` / `featureDeleteReplayAuthorizer`）：
   * 模块与功能行已软删除、退出可读范围，首次执行用的资源复核必然 404，因此重放
   * 只复核「如果模块还在，这个人当初还能不能删」——仍读实时成员关系，组长被转移
   * 或移除、降级为普通成员后重放一律拒绝，系统管理员保持放行；项目本身已删除时
   * 授权范围必然不含它，同样拒绝。当前认证（Session 有效、用户未被停用）由 HTTP
   * 层在调用前完成。
   */
  async scopeDeleterReplayRole(
    tx: TransactionContext,
    actorUserId: number,
    projectId: number,
  ): Promise<"SYSTEM_ADMIN" | "LEADER" | "MEMBER" | "NOT_MEMBER"> {
    return this.scopeDeleterRole(tx, actorUserId, projectId);
  }
}
