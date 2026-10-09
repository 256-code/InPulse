import { Inject, Injectable } from "@nestjs/common";
import type { TransactionContext } from "../../database/transaction-context.js";
import { ProjectRoleGateService } from "../projects/index.js";
import {
  FeatureManagementRepository,
  type FeatureDeletionRow,
  type FeatureSoftDeletedRow,
} from "./feature-management.repository.js";

/**
 * ADR-059：删除功能的错误口径，与模块侧同构。
 */
export class FeatureDeletionError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 422,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const featureDeletionMissing = () =>
  new FeatureDeletionError(
    404,
    "FEATURE_NOT_FOUND",
    "项目或功能不存在或无法访问",
  );
export const featureDeletionForbidden = () =>
  new FeatureDeletionError(
    403,
    "FEATURE_DELETE_FORBIDDEN",
    "只有系统管理员或本项目组长可以删除功能",
  );
export const featureDeletionVersionConflict = () =>
  new FeatureDeletionError(
    409,
    "FEATURE_VERSION_CONFLICT",
    "功能版本已变化，请重新加载后删除",
  );
/** ADR-059：范围内仍有活跃聚合组主任务，必须先解除合并再删功能。 */
export const featureTaskGroupMainLocked = (taskIds: readonly number[]) =>
  new FeatureDeletionError(
    409,
    "TASK_GROUP_MAIN_LOCKED",
    `功能下仍有聚合组主任务（任务 ${taskIds.join("、")}），请先解除合并后再删除`,
  );

/**
 * ADR-059：删除功能在本域需要暴露的边界。删除模块时对功能的批量软删除也走
 * 这里——模块级联复用 `listAliveOfModule` + `softDelete`，不另开旁路。
 */
export abstract class FeatureDeletionCommandPort {
  /** 与模块侧同一角色门禁；不含资源存在性检查，理由见 `ModuleDeletionCommandPort`。 */
  abstract authorize(
    tx: TransactionContext,
    actorId: number,
    projectId: number,
  ): Promise<void>;
  abstract findForDeletion(
    tx: TransactionContext,
    projectId: number,
    moduleId: number,
    featureId: number,
    lock?: boolean,
  ): Promise<FeatureDeletionRow | undefined>;
  /** 删除模块时使用：按功能 ID 升序取模块下全部存活功能，`lock` 为真时取行锁。 */
  abstract listAliveOfModule(
    tx: TransactionContext,
    projectId: number,
    moduleId: number,
    lock?: boolean,
  ): Promise<readonly FeatureDeletionRow[]>;
  abstract softDelete(
    tx: TransactionContext,
    current: FeatureDeletionRow,
    actorId: number,
  ): Promise<FeatureSoftDeletedRow | undefined>;
}

@Injectable()
export class SqlFeatureDeletionCommandPort extends FeatureDeletionCommandPort {
  constructor(
    @Inject(ProjectRoleGateService)
    private readonly roles: ProjectRoleGateService,
    @Inject(FeatureManagementRepository)
    private readonly repository: FeatureManagementRepository,
  ) {
    super();
  }

  async authorize(
    tx: TransactionContext,
    actorId: number,
    projectId: number,
  ): Promise<void> {
    const role = await this.roles.scopeDeleterRole(tx, actorId, projectId);
    if (role === "NOT_MEMBER") throw featureDeletionMissing();
    if (role !== "SYSTEM_ADMIN" && role !== "LEADER")
      throw featureDeletionForbidden();
  }

  findForDeletion(
    tx: TransactionContext,
    projectId: number,
    moduleId: number,
    featureId: number,
    lock = false,
  ): Promise<FeatureDeletionRow | undefined> {
    return this.repository.findForDeletion(
      tx,
      projectId,
      moduleId,
      featureId,
      lock,
    );
  }

  listAliveOfModule(
    tx: TransactionContext,
    projectId: number,
    moduleId: number,
    lock = false,
  ): Promise<readonly FeatureDeletionRow[]> {
    return this.repository.listAliveOfModule(tx, projectId, moduleId, lock);
  }

  softDelete(
    tx: TransactionContext,
    current: FeatureDeletionRow,
    actorId: number,
  ): Promise<FeatureSoftDeletedRow | undefined> {
    return this.repository.softDelete(tx, current, actorId);
  }
}
