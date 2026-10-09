import { Inject, Injectable } from "@nestjs/common";
import { AuditWritePort } from "../audit/index.js";
import type { TransactionContext } from "../database/transaction-context.js";
import { PostgresUnitOfWork } from "../database/unit-of-work.js";
import { ActivityWritePort } from "../modules/activity/index.js";
import { RecordScopeVoidPort } from "../modules/change-records/record-scope-void.port.js";
import {
  FeatureDeletionCommandPort,
  featureDeletionMissing,
  featureDeletionVersionConflict,
  featureTaskGroupMainLocked,
} from "../modules/features/feature-deletion.command-port.js";
import type { FeatureSoftDeletedRow } from "../modules/features/feature-management.repository.js";
import { ExternalLinksCommandPort } from "../modules/external-links/external-links.port.js";
import {
  ModuleDeletionCommandPort,
  moduleDeletionMissing,
  moduleDeletionVersionConflict,
  moduleTaskGroupMainLocked,
  moduleUnclassifiedProtected,
} from "../modules/modules/module-deletion.command-port.js";
import type { ModuleSoftDeletedRow } from "../modules/modules/module-management.repository.js";
import {
  PROJECT_ACCESS_QUERY_PORT,
  type ProjectAccessQueryPort,
} from "../modules/projects/index.js";
import { SearchProjectionWritePort } from "../modules/search/index.js";
import { TaskDeletionCommandPort } from "../modules/tasks/task-deletion.command-port.js";
import { TaskDeletionWorkflow } from "./task-deletion.workflow.js";

/** ADR-059：删除模块的响应，字段与 ModuleDeletionResponse 契约一一对应。 */
export interface ModuleDeletionResult {
  readonly id: number;
  readonly projectId: number;
  readonly code: string;
  readonly name: string;
  readonly kind: ModuleSoftDeletedRow["kind"];
  readonly deletedAt: string;
  readonly deletedBy: number;
  readonly deletedFeatureCount: number;
  readonly deletedTaskCount: number;
  readonly voidedRecordCount: number;
  readonly removedLinkCount: number;
}

/** ADR-059：删除功能的响应，字段与 FeatureDeletionResponse 契约一一对应。 */
export interface FeatureDeletionResult {
  readonly id: number;
  readonly projectId: number;
  readonly moduleId: number;
  readonly code: string;
  readonly name: string;
  readonly deletedAt: string;
  readonly deletedBy: number;
  readonly deletedTaskCount: number;
  readonly voidedRecordCount: number;
  readonly removedLinkCount: number;
}

const DEFAULT_MODULE_REASON = "模块已被删除";
const DEFAULT_FEATURE_REASON = "功能已被删除";

/**
 * ADR-059：删除模块与删除功能的跨域编排。两者共用同一事务，按
 * 项目 -> 模块 -> 功能 -> 任务的父到子顺序取锁，级联删除所含功能与任务：
 * 任务逐条复用 `TaskDeletionWorkflow.deleteWithinTransaction`（ADR-058 的全部
 * 副作用链：解除链接关联、作废该任务记录、处理聚合组、审计、动态、搜索投影），
 * 功能与模块自身再补软删除、链接解除、范围内记录作废与投影维护。
 *
 * 删除是软删除（`deleted_at` / `deleted_by`），不提供还原入口，也不物理删除
 * 任何业务历史；物理清除只随所属项目的彻底删除（ADR-051 / ADR-055）发生。
 */
@Injectable()
export class ScopeDeletionWorkflow {
  constructor(
    @Inject(PostgresUnitOfWork) private readonly uow: PostgresUnitOfWork,
    @Inject(PROJECT_ACCESS_QUERY_PORT)
    private readonly access: ProjectAccessQueryPort,
    @Inject(ModuleDeletionCommandPort)
    private readonly modules: ModuleDeletionCommandPort,
    @Inject(FeatureDeletionCommandPort)
    private readonly features: FeatureDeletionCommandPort,
    @Inject(TaskDeletionCommandPort)
    private readonly tasks: TaskDeletionCommandPort,
    @Inject(TaskDeletionWorkflow)
    private readonly taskDeletion: TaskDeletionWorkflow,
    @Inject(RecordScopeVoidPort) private readonly records: RecordScopeVoidPort,
    @Inject(ExternalLinksCommandPort)
    private readonly links: ExternalLinksCommandPort,
    @Inject(AuditWritePort) private readonly audit: AuditWritePort,
    @Inject(ActivityWritePort) private readonly activity: ActivityWritePort,
    @Inject(SearchProjectionWritePort)
    private readonly search: SearchProjectionWritePort,
  ) {}

  async deleteModule(
    actorId: number,
    projectId: number,
    moduleId: number,
    expectedRowVersion: number,
    reason: string | null,
    requestId: string,
  ): Promise<ModuleDeletionResult> {
    const deletionReason = reason?.trim()
      ? reason.trim()
      : DEFAULT_MODULE_REASON;
    return this.uow.run(async (tx) => {
      // 角色门禁先行（普通成员 403、非成员 404），再取项目行的 FOR SHARE，
      // 与其它写命令的父到子取锁顺序一致。
      await this.modules.authorize(tx, actorId, projectId);
      if (!(await this.lockProject(tx, actorId, projectId)))
        throw moduleDeletionMissing();
      const current = await this.modules.findForDeletion(
        tx,
        projectId,
        moduleId,
        true,
      );
      if (!current) throw moduleDeletionMissing();
      // ADR-059 §2.2：未分类模块由项目引导流程保证唯一，不能删除。
      if (current.kind !== "NORMAL") throw moduleUnclassifiedProtected();
      if (current.rowVersion !== expectedRowVersion)
        throw moduleDeletionVersionConflict();

      const features = await this.softDeleteModuleFeatures(
        tx,
        actorId,
        projectId,
        moduleId,
        deletionReason,
        requestId,
      );
      const deleted = await this.modules.softDelete(tx, current, actorId);
      if (!deleted) throw moduleDeletionVersionConflict();

      const cascade = await this.cascadeTasks(
        tx,
        actorId,
        projectId,
        { moduleId, featureId: null },
        deletionReason,
        requestId,
      );
      // 逐任务级联只作废了任务自身关联的记录；模块级记录与该模块各功能下
      // 未关联任务的记录在这里补作废，两条路径合并成最终计数。
      const scopeVoided = await this.records.voidScopeRecords(tx, {
        projectId,
        moduleId,
        featureId: null,
        actorId,
        requestId,
        reason: deletionReason,
      });
      const voidedRecordCount = cascade.voidedRecordCount + scopeVoided.length;
      // 链接解除分两段：功能自身在软删除功能时解除，任务在逐任务级联里解除。
      const removedLinkCount =
        cascade.removedLinkCount + features.removedLinkCount;

      const featureRows = features.features;

      const event = await this.audit.append(tx, {
        projectId,
        actorType: "USER",
        actorId,
        action: "module.delete",
        targetType: "MODULE",
        targetId: String(moduleId),
        eventPayload: {
          moduleId,
          code: deleted.code,
          name: deleted.name,
          kind: deleted.kind,
          deletedFeatureIds: featureRows.map((feature) => feature.id),
          deletedTaskCount: cascade.deletedTaskCount,
          voidedRecords: scopeVoided.map((entry) => entry.recordId),
          removedLinkCount,
          reason: deletionReason,
        },
        requestId,
      });
      // 删除对项目成员可见：项目动态保留「谁删了哪个模块」，审计链只追加。
      const visibility = {
        projectId,
        sourceEntityType: "MODULE" as const,
        sourceEntityId: moduleId,
        visibilityScope: "MEMBER" as const,
        sourceStatus: "DELETED",
        sourceRowVersion: deleted.rowVersion,
      };
      await this.activity.updateEntityVisibility(tx, visibility);
      await this.activity.append(tx, {
        ...visibility,
        sourceChainId: event.chainId,
        sourceSequence: event.sequenceNo,
        activityType: "MODULE_DELETED",
        actorId,
        summary: `删除模块：${deleted.name}`,
        metadata: {
          moduleId,
          code: deleted.code,
          kind: deleted.kind,
          deletedFeatureCount: featureRows.length,
          deletedTaskCount: cascade.deletedTaskCount,
          voidedRecordIds: scopeVoided.map((entry) => entry.recordId),
          removedLinkCount,
        },
        occurredAt: new Date(deleted.deletedAt),
      });
      await this.search.remove(tx, projectId, "MODULE", moduleId);
      return {
        id: deleted.id,
        projectId: deleted.projectId,
        code: deleted.code,
        name: deleted.name,
        kind: deleted.kind,
        deletedAt: new Date(deleted.deletedAt).toISOString(),
        deletedBy: actorId,
        deletedFeatureCount: featureRows.length,
        deletedTaskCount: cascade.deletedTaskCount,
        voidedRecordCount,
        removedLinkCount,
      };
    });
  }

  async deleteFeature(
    actorId: number,
    projectId: number,
    moduleId: number,
    featureId: number,
    expectedRowVersion: number,
    reason: string | null,
    requestId: string,
  ): Promise<FeatureDeletionResult> {
    const deletionReason = reason?.trim()
      ? reason.trim()
      : DEFAULT_FEATURE_REASON;
    return this.uow.run(async (tx) => {
      await this.features.authorize(tx, actorId, projectId);
      if (!(await this.lockProject(tx, actorId, projectId)))
        throw featureDeletionMissing();
      const current = await this.features.findForDeletion(
        tx,
        projectId,
        moduleId,
        featureId,
        true,
      );
      if (!current) throw featureDeletionMissing();
      if (current.rowVersion !== expectedRowVersion)
        throw featureDeletionVersionConflict();

      const deleted = await this.features.softDelete(tx, current, actorId);
      if (!deleted) throw featureDeletionVersionConflict();
      const removedLinkCount = await this.links.detachTarget(
        tx,
        projectId,
        "FEATURE",
        featureId,
      );
      const cascade = await this.cascadeTasks(
        tx,
        actorId,
        projectId,
        { moduleId, featureId },
        deletionReason,
        requestId,
      );
      // 模块级影响任务（`scope_type = 'MODULE'`）不属于本功能，不参与级联；
      // 记录作废也只覆盖 `scope_type = 'FEATURE'` 且归属本功能的记录。
      const scopeVoided = await this.records.voidScopeRecords(tx, {
        projectId,
        moduleId,
        featureId,
        actorId,
        requestId,
        reason: deletionReason,
      });
      await this.emitFeatureDeleted(tx, {
        projectId,
        actorId,
        feature: deleted,
        deletedTaskCount: cascade.deletedTaskCount,
        voidedRecordIds: scopeVoided.map((entry) => entry.recordId),
        removedLinkCount,
        reason: deletionReason,
        requestId,
      });
      return {
        id: deleted.id,
        projectId: deleted.projectId,
        moduleId: deleted.moduleId,
        code: deleted.code,
        name: deleted.name,
        deletedAt: new Date(deleted.deletedAt).toISOString(),
        deletedBy: actorId,
        deletedTaskCount: cascade.deletedTaskCount,
        voidedRecordCount: cascade.voidedRecordCount + scopeVoided.length,
        removedLinkCount: cascade.removedLinkCount + removedLinkCount,
      };
    });
  }

  /**
   * 项目行的 FOR SHARE：与其它写命令一致地在最外层先锁项目，再锁下级。
   * 未命中时返回 false，由调用方抛出与自身资源一致的 404。
   */
  private async lockProject(
    tx: TransactionContext,
    actorId: number,
    projectId: number,
  ): Promise<boolean> {
    const check = await this.access.checkProjectForWrite(tx, {
      actorUserId: actorId,
      projectId,
    });
    return check.kind !== "not-found";
  }

  /**
   * 删除模块时先按功能 ID 升序锁住全部存活功能再逐个软删除：功能行的锁在任务
   * 级联之前全部拿到，避免与其它写命令在功能行上交叉等待。
   */
  private async softDeleteModuleFeatures(
    tx: TransactionContext,
    actorId: number,
    projectId: number,
    moduleId: number,
    reason: string,
    requestId: string,
  ): Promise<{
    readonly features: readonly FeatureSoftDeletedRow[];
    readonly removedLinkCount: number;
  }> {
    const alive = await this.features.listAliveOfModule(
      tx,
      projectId,
      moduleId,
      true,
    );
    const deleted: FeatureSoftDeletedRow[] = [];
    let removedLinkCount = 0;
    for (const feature of alive) {
      // 功能行锁已持有，这里的条件更新只可能因为并发写而落空，属真实冲突。
      const soft = await this.features.softDelete(tx, feature, actorId);
      if (!soft) throw featureDeletionVersionConflict();
      const detached = await this.links.detachTarget(
        tx,
        projectId,
        "FEATURE",
        soft.id,
      );
      removedLinkCount += detached;
      await this.emitFeatureDeleted(tx, {
        projectId,
        actorId,
        feature: soft,
        deletedTaskCount: null,
        voidedRecordIds: [],
        removedLinkCount: detached,
        reason,
        requestId,
        cascadeFromModuleId: moduleId,
      });
      deleted.push(soft);
    }
    return { features: deleted, removedLinkCount };
  }

  /**
   * 按 ID 升序一次性锁住范围内全部任务，再逐条走单任务删除入口。任务的审计、
   * 动态与搜索投影由 `TaskDeletionWorkflow` 负责，这里只汇总计数。
   *
   * 主任务门禁必须先于任何逐条删除整体判定：逐条处理时先删的来源会把所在组
   * 关掉、主任务随之变成非 MAIN，同一个模块的删除结果会依赖任务 ID 顺序。
   */
  private async cascadeTasks(
    tx: TransactionContext,
    actorId: number,
    projectId: number,
    scope: { readonly moduleId: number; readonly featureId: number | null },
    reason: string,
    requestId: string,
  ): Promise<{
    readonly deletedTaskCount: number;
    readonly voidedRecordCount: number;
    readonly removedLinkCount: number;
  }> {
    const mainTaskIds = await this.tasks.listActiveMainTaskIds(
      tx,
      projectId,
      scope,
    );
    if (mainTaskIds.length > 0) {
      throw scope.featureId === null
        ? moduleTaskGroupMainLocked(mainTaskIds)
        : featureTaskGroupMainLocked(mainTaskIds);
    }
    const targets = await this.tasks.listForScope(tx, projectId, scope, true);
    let deletedTaskCount = 0;
    let voidedRecordCount = 0;
    let removedLinkCount = 0;
    for (const target of targets) {
      const result = await this.taskDeletion.deleteWithinTransaction(tx, {
        projectId,
        taskId: target.id,
        rowVersion: target.rowVersion,
        actorId,
        reason,
        requestId,
      });
      deletedTaskCount += 1;
      voidedRecordCount += result.voidedRecordCount;
      removedLinkCount += result.removedLinkCount;
    }
    return { deletedTaskCount, voidedRecordCount, removedLinkCount };
  }

  /** 功能被删除时的审计、项目动态与搜索投影，模块级联与单功能删除共用。 */
  private async emitFeatureDeleted(
    tx: TransactionContext,
    input: {
      readonly projectId: number;
      readonly actorId: number;
      readonly feature: FeatureSoftDeletedRow;
      /** 模块级联时任务尚未删除，计数写在模块事件里，这里传 null 表示不适用。 */
      readonly deletedTaskCount: number | null;
      readonly voidedRecordIds: readonly number[];
      readonly removedLinkCount: number;
      readonly reason: string;
      readonly requestId: string;
      readonly cascadeFromModuleId?: number;
    },
  ): Promise<void> {
    const { feature } = input;
    const event = await this.audit.append(tx, {
      projectId: input.projectId,
      actorType: "USER",
      actorId: input.actorId,
      action: "feature.delete",
      targetType: "FEATURE",
      targetId: String(feature.id),
      eventPayload: {
        featureId: feature.id,
        moduleId: feature.moduleId,
        code: feature.code,
        name: feature.name,
        deletedTaskCount: input.deletedTaskCount,
        voidedRecords: [...input.voidedRecordIds],
        removedLinkCount: input.removedLinkCount,
        reason: input.reason,
        cascadeFromModuleId: input.cascadeFromModuleId ?? null,
      },
      requestId: input.requestId,
    });
    const visibility = {
      projectId: input.projectId,
      sourceEntityType: "FEATURE" as const,
      sourceEntityId: feature.id,
      visibilityScope: "MEMBER" as const,
      sourceStatus: "DELETED",
      sourceRowVersion: feature.rowVersion,
    };
    await this.activity.updateEntityVisibility(tx, visibility);
    await this.activity.append(tx, {
      ...visibility,
      sourceChainId: event.chainId,
      sourceSequence: event.sequenceNo,
      activityType: "FEATURE_DELETED",
      actorId: input.actorId,
      summary: `删除功能：${feature.name}`,
      metadata: {
        featureId: feature.id,
        moduleId: feature.moduleId,
        code: feature.code,
        deletedTaskCount: input.deletedTaskCount,
        voidedRecordIds: [...input.voidedRecordIds],
        removedLinkCount: input.removedLinkCount,
        cascadeFromModuleId: input.cascadeFromModuleId ?? null,
      },
      occurredAt: new Date(feature.deletedAt),
    });
    await this.search.remove(tx, input.projectId, "FEATURE", feature.id);
  }
}
