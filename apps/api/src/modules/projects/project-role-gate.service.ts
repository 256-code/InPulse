import { Inject, Injectable } from "@nestjs/common";

import type { TransactionContext } from "../../database/transaction-context.js";
import {
  PROJECT_ACCESS_QUERY_PORT,
  type ProjectAccessQueryPort,
} from "./project-access.port.js";
import { ProjectMembersQueryPort } from "./project-members-query.port.js";

/**
 * ADR-039：项目内管理操作（成员增删、模块/功能/任务归档恢复、项目状态变更、
 * 归档申请）对全体活跃成员开放，`LEADER` 只是身份标识，不再单独授予管理权。
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
   * ADR-039 角色任命门禁：与 `manageRole` 同源但口径更窄，只有系统管理员放行，
   * 本项目组长与普通成员归入 `MEMBER`（403），非成员归入 `NOT_MEMBER`（404）。
   * 单独成方法是为了防止以后有人拿 `manageRole` 放行成员自行改角色。
   */
  async roleSetterRole(
    tx: TransactionContext,
    actorUserId: number,
    projectId: number,
  ): Promise<"SYSTEM_ADMIN" | "MEMBER" | "NOT_MEMBER"> {
    const role = await this.manageRole(tx, actorUserId, projectId);
    if (role === "SYSTEM_ADMIN") return "SYSTEM_ADMIN";
    if (role === "NOT_MEMBER") return "NOT_MEMBER";
    return "MEMBER";
  }
}
