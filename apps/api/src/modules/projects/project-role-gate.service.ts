import { Inject, Injectable } from "@nestjs/common";

import type { TransactionContext } from "../../database/transaction-context.js";
import {
  PROJECT_ACCESS_QUERY_PORT,
  type ProjectAccessQueryPort,
} from "./project-access.port.js";
import { ProjectMembersQueryPort } from "./project-members-query.port.js";

/** ADR-033：可执行项目内管理操作（成员增删、模块归档/恢复）的角色。 */
export type ProjectManageRole = "SYSTEM_ADMIN" | "LEADER" | "PROJECT_ADMIN";

/**
 * ADR-033 项目内角色门禁：只读实时成员关系与全局管理员标记，不缓存进
 * Session。返回类型化结果，HTTP/Use Case 负责映射 403/404：
 * - `NOT_MEMBER`：非本项目活跃成员（含已移除），调用方按资源不存在 404；
 * - `MEMBER`：普通成员，调用方按 403 拒绝；
 * - 其余为可管理角色。
 */
export type ProjectRoleGateResult = ProjectManageRole | "MEMBER" | "NOT_MEMBER";

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

  /** 角色任命门禁：系统管理员可设全部角色；本项目组长只能任命/撤销项目管理员。 */
  async roleSetterRole(
    tx: TransactionContext,
    actorUserId: number,
    projectId: number,
  ): Promise<"SYSTEM_ADMIN" | "LEADER" | "MEMBER" | "NOT_MEMBER"> {
    const role = await this.manageRole(tx, actorUserId, projectId);
    return role === "PROJECT_ADMIN" ? "MEMBER" : role;
  }
}
