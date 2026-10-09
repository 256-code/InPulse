import { Inject, Injectable } from "@nestjs/common";
import type { TransactionContext } from "../../database/transaction-context.js";
import { ProjectRoleGateService } from "../projects/index.js";
import {
  ModuleManagementRepository,
  type ModuleDeletionRow,
  type ModuleSoftDeletedRow,
} from "./module-management.repository.js";

/**
 * ADR-059：删除模块的错误口径。403 表示本项目普通成员，404 同时覆盖
 * 「不存在」与「不可访问」，避免泄露资源存在性；409 有两个来源——未分类模块
 * 受保护，以及行版本落后。
 */
export class ModuleDeletionError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 422,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const moduleDeletionMissing = () =>
  new ModuleDeletionError(
    404,
    "MODULE_NOT_FOUND",
    "项目或模块不存在或无法访问",
  );
export const moduleDeletionForbidden = () =>
  new ModuleDeletionError(
    403,
    "MODULE_DELETE_FORBIDDEN",
    "只有系统管理员或本项目组长可以删除模块",
  );
/**
 * ADR-059 §2.2：未分类模块由项目引导流程保证唯一且承载新建任务的默认归属，
 * 不能删除（`0001` 的 `modules_protect_unclassified` 触发器仍然禁止物理删除）。
 */
export const moduleUnclassifiedProtected = () =>
  new ModuleDeletionError(
    409,
    "MODULE_UNCLASSIFIED_PROTECTED",
    "未分类模块不能删除",
  );
export const moduleDeletionVersionConflict = () =>
  new ModuleDeletionError(
    409,
    "MODULE_VERSION_CONFLICT",
    "模块版本已变化，请重新加载后删除",
  );
/** ADR-059：范围内仍有活跃聚合组主任务，必须先解除合并再删模块。 */
export const moduleTaskGroupMainLocked = (taskIds: readonly number[]) =>
  new ModuleDeletionError(
    409,
    "TASK_GROUP_MAIN_LOCKED",
    `模块下仍有聚合组主任务（任务 ${taskIds.join("、")}），请先解除合并后再删除`,
  );

/**
 * ADR-059：删除模块在本域需要暴露的边界。跨域级联由 `ScopeDeletionWorkflow`
 * 承担，本 Port 只提供角色门禁、模块行的读取与软删除。
 */
export abstract class ModuleDeletionCommandPort {
  /**
   * 角色门禁（只有系统管理员或本项目 ACTIVE 组长，其余成员 403、非成员 404）。
   * 不含资源存在性检查：幂等重放时模块已软删除，首次执行与重放都只能复核
   * 「如果模块还在，这个人当初还能不能删」（ADR-059 §2.8）。
   */
  abstract authorize(
    tx: TransactionContext,
    actorId: number,
    projectId: number,
  ): Promise<void>;
  abstract findForDeletion(
    tx: TransactionContext,
    projectId: number,
    moduleId: number,
    lock?: boolean,
  ): Promise<ModuleDeletionRow | undefined>;
  abstract softDelete(
    tx: TransactionContext,
    current: ModuleDeletionRow,
    actorId: number,
  ): Promise<ModuleSoftDeletedRow | undefined>;
}

@Injectable()
export class SqlModuleDeletionCommandPort extends ModuleDeletionCommandPort {
  constructor(
    @Inject(ProjectRoleGateService)
    private readonly roles: ProjectRoleGateService,
    @Inject(ModuleManagementRepository)
    private readonly repository: ModuleManagementRepository,
  ) {
    super();
  }

  async authorize(
    tx: TransactionContext,
    actorId: number,
    projectId: number,
  ): Promise<void> {
    const role = await this.roles.scopeDeleterRole(tx, actorId, projectId);
    if (role === "NOT_MEMBER") throw moduleDeletionMissing();
    if (role !== "SYSTEM_ADMIN" && role !== "LEADER")
      throw moduleDeletionForbidden();
  }

  findForDeletion(
    tx: TransactionContext,
    projectId: number,
    moduleId: number,
    lock = false,
  ): Promise<ModuleDeletionRow | undefined> {
    return this.repository.findForDeletion(tx, projectId, moduleId, lock);
  }

  softDelete(
    tx: TransactionContext,
    current: ModuleDeletionRow,
    actorId: number,
  ): Promise<ModuleSoftDeletedRow | undefined> {
    return this.repository.softDelete(tx, current, actorId);
  }
}
