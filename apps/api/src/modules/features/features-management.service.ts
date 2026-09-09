import { FeatureCandidatesQueryPort } from "../search/index.js";
import { ModuleQueryPort, ModuleReadPort } from "../modules/index.js";
import { ProjectCodePort } from "../projects/index.js";
import { Inject, Injectable } from "@nestjs/common";
import {
  featureReplayContextSchema,
  type FeatureEditRequest,
  type FeatureItem,
} from "@inpulse/api-contract";
import { AuditWritePort } from "../../audit/index.js";
import type { TransactionContext } from "../../database/transaction-context.js";
import { PostgresUnitOfWork } from "../../database/unit-of-work.js";
import { ActivityWritePort } from "../activity/index.js";
import {
  PROJECT_ACCESS_QUERY_PORT,
  type ProjectAccessQueryPort,
} from "../projects/index.js";
import { SearchProjectionWritePort } from "../search/index.js";
import { FeatureManagementRepository } from "./feature-management.repository.js";

export type FeatureOperation =
  "createFeature" | "updateFeature" | "archiveFeature" | "restoreFeature";
export class FeatureManagementError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 422,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
const missing = () =>
  new FeatureManagementError(
    404,
    "FEATURE_NOT_FOUND",
    "项目或功能不存在或无法访问",
  );
export function assertFeatureTransition(
  operation: FeatureOperation,
  current: Pick<FeatureItem, "rowVersion" | "status">,
  version: number,
): void {
  if (current.rowVersion !== version)
    throw new FeatureManagementError(
      409,
      "FEATURE_VERSION_CONFLICT",
      "功能版本已变化，请重新加载后编辑",
    );
  if (
    current.status !== (operation === "restoreFeature" ? "ARCHIVED" : "ACTIVE")
  )
    throw new FeatureManagementError(
      409,
      "FEATURE_STATE_CONFLICT",
      "功能状态不允许此操作",
    );
}

@Injectable()
export class FeaturesManagementService {
  constructor(
    @Inject(PROJECT_ACCESS_QUERY_PORT)
    private readonly access: ProjectAccessQueryPort,
    @Inject(FeatureCandidatesQueryPort)
    private readonly candidates: FeatureCandidatesQueryPort,
    @Inject(ModuleQueryPort) private readonly modules: ModuleQueryPort,
    @Inject(ModuleReadPort) private readonly moduleRead: ModuleReadPort,
    @Inject(ProjectCodePort) private readonly codes: ProjectCodePort,
    @Inject(PostgresUnitOfWork) private readonly uow: PostgresUnitOfWork,
    @Inject(FeatureManagementRepository)
    private readonly repository: FeatureManagementRepository,
    @Inject(AuditWritePort) private readonly audit: AuditWritePort,
    @Inject(ActivityWritePort) private readonly activity: ActivityWritePort,
    @Inject(SearchProjectionWritePort)
    private readonly search: SearchProjectionWritePort,
  ) {}

  async read(
    actorId: number,
    projectId: number,
    moduleId: number,
    featureId?: number,
  ) {
    const scope = await this.access.getAuthorizedSearchScope(actorId);
    if (!scope.projectIds.includes(projectId)) throw missing();
    return this.uow.run(async (tx) => {
      if (!(await this.moduleRead.find(tx, projectId, moduleId)))
        throw missing();
      if (featureId !== undefined) {
        const item = await this.repository.find(
          tx,
          projectId,
          featureId,
          moduleId,
        );
        if (!item) throw missing();
        return item;
      }
      return { items: await this.repository.list(tx, projectId, moduleId) };
    });
  }

  async similar(
    actorId: number,
    projectId: number,
    moduleId: number,
    query: string,
  ) {
    const scope = await this.access.getAuthorizedSearchScope(actorId);
    if (!scope.projectIds.includes(projectId)) throw missing();
    return this.uow.run(async (tx) => {
      if (!(await this.moduleRead.find(tx, projectId, moduleId)))
        throw missing();
      const ids = await this.candidates.find(tx, scope, projectId, query);
      return { items: await this.repository.candidates(tx, projectId, ids) };
    });
  }

  async authorize(
    tx: TransactionContext,
    actorId: number,
    projectId: number,
    moduleId: number,
    featureId?: number,
  ): Promise<void> {
    const check = await this.access.checkProjectForWrite(tx, {
      actorUserId: actorId,
      projectId,
    });
    if (check.kind === "not-found") throw missing();
    // 先验证真实归属，避免向错误项目参数请求泄露资源状态。
    if (
      featureId !== undefined &&
      !(await this.repository.find(tx, projectId, featureId, moduleId))
    )
      throw missing();
    const module = await this.modules.checkModuleForWrite(tx, {
      projectId,
      moduleId,
    });
    if (module.kind === "not-found") throw missing();
    if (
      check.kind === "parent-not-active" ||
      module.kind === "parent-not-active"
    )
      throw new FeatureManagementError(
        409,
        "FEATURE_PROJECT_ARCHIVED",
        "项目或模块已归档，功能只读",
      );
  }

  async replay(
    tx: TransactionContext,
    actorId: number,
    context: unknown,
  ): Promise<void> {
    const resource = featureReplayContextSchema.parse(context);
    await this.authorize(
      tx,
      actorId,
      resource.projectId,
      resource.moduleId,
      resource.featureId,
    );
  }

  async execute(
    tx: TransactionContext,
    input: {
      operation: FeatureOperation;
      actorId: number;
      projectId: number;
      moduleId: number;
      featureId?: number;
      version?: number;
      edit?: FeatureEditRequest;
      reason?: string;
      requestId: string;
    },
  ): Promise<FeatureItem> {
    await this.authorize(
      tx,
      input.actorId,
      input.projectId,
      input.moduleId,
      input.featureId,
    );
    const action = input.operation.replace("Feature", "");
    let previous: FeatureItem | undefined;
    let result: FeatureItem;
    if (input.operation === "createFeature") {
      result = await this.repository.create(
        tx,
        input.projectId,
        input.actorId,
        input.moduleId,
        await this.codes.allocateFeatureCode(tx, input.projectId),
        input.edit!,
      );
    } else {
      // 父项目共享锁在前；功能排他锁阻止与子级写前 FOR SHARE 检查并行。
      previous = await this.repository.find(
        tx,
        input.projectId,
        input.featureId!,
        input.moduleId,
        true,
      );
      if (!previous) throw missing();
      assertFeatureTransition(input.operation, previous, input.version!);
      const updated = await this.repository.update(tx, previous, {
        name: input.edit?.name ?? previous.name,
        currentBehavior:
          input.edit?.currentBehavior ?? previous.currentBehavior,
        tags: input.edit?.tags ?? previous.tags,
        status: input.operation === "archiveFeature" ? "ARCHIVED" : "ACTIVE",
      });
      if (!updated)
        throw new FeatureManagementError(
          409,
          "FEATURE_VERSION_CONFLICT",
          "功能版本已变化，请重新加载后编辑",
        );
      result = updated;
    }
    const audit = await this.audit.append(tx, {
      projectId: result.projectId,
      actorType: "USER",
      actorId: input.actorId,
      action: `feature.${action}`,
      targetType: "FEATURE",
      targetId: String(result.id),
      eventPayload: {
        before: previous ?? null,
        after: result,
        reason: input.reason ?? null,
      },
      requestId: input.requestId,
    });
    await this.activity.append(tx, {
      projectId: result.projectId,
      sourceChainId: audit.chainId,
      sourceSequence: audit.sequenceNo,
      sourceEntityType: "FEATURE",
      sourceEntityId: result.id,
      activityType: `feature.${action}`,
      actorId: input.actorId,
      summary: `功能${{ create: "创建", update: "更新", archive: "归档", restore: "恢复" }[action] ?? action}：${result.name}`,
      metadata: { featureId: result.id, moduleId: result.moduleId },
      visibilityScope: "MEMBER",
      sourceStatus: result.status,
      sourceRowVersion: result.rowVersion,
      occurredAt: new Date(result.updatedAt),
    });
    await this.search.upsert(tx, {
      projectId: result.projectId,
      entityType: "FEATURE",
      entityId: result.id,
      title: result.name,
      summary: result.currentBehavior.slice(0, 5000),
      rawText: `${result.code}\n${result.name}\n${result.currentBehavior}`,
      visibilityScope: "MEMBER",
      sourceStatus: result.status,
      sourceRowVersion: result.rowVersion,
    });
    return result;
  }
}
