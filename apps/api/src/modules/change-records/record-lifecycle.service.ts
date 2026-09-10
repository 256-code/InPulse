import { Inject, Injectable } from "@nestjs/common";
import { schemaRegistry } from "@inpulse/api-contract";
import type { TransactionContext } from "../../database/transaction-context.js";
import {
  PROJECT_ACCESS_QUERY_PORT,
  type ProjectAccessQueryPort,
} from "../projects/index.js";
import { ModuleQueryPort } from "../modules/index.js";
import { FeatureQueryPort } from "../features/index.js";
import { AuditWritePort } from "../../audit/index.js";
import { ActivityWritePort } from "../activity/index.js";
import { SearchProjectionWritePort } from "../search/index.js";
import { PublishedRecordRepository } from "./published-record.repository.js";
import { RecordPublicationRepository } from "./record-publication.repository.js";
import { RecordLifecycleRepository } from "./record-lifecycle.repository.js";
import { RecordDraftError } from "./record-drafts.service.js";
import { validatePublishedRecordSearch } from "./record-publication-effects.js";
const missing = () =>
  new RecordDraftError(404, "CHANGE_RECORD_NOT_FOUND", "记录不存在或无法访问");
const conflict = () =>
  new RecordDraftError(
    409,
    "RECORD_STATE_CONFLICT",
    "记录状态或版本已变化，请刷新后重试",
  );
@Injectable()
export class RecordLifecycleService {
  constructor(
    @Inject(PROJECT_ACCESS_QUERY_PORT)
    private readonly access: ProjectAccessQueryPort,
    @Inject(ModuleQueryPort) private readonly modules: ModuleQueryPort,
    @Inject(FeatureQueryPort) private readonly features: FeatureQueryPort,
    @Inject(RecordPublicationRepository)
    private readonly identities: RecordPublicationRepository,
    @Inject(PublishedRecordRepository)
    private readonly records: PublishedRecordRepository,
    @Inject(RecordLifecycleRepository)
    private readonly repository: RecordLifecycleRepository,
    @Inject(AuditWritePort) private readonly audit: AuditWritePort,
    @Inject(ActivityWritePort) private readonly activity: ActivityWritePort,
    @Inject(SearchProjectionWritePort)
    private readonly search: SearchProjectionWritePort,
  ) {}
  async replay(tx: TransactionContext, actorId: number, context: unknown) {
    const { projectId, recordId } =
      schemaRegistry.RecordLifecycleReplayContext.schema.parse(context);
    const project = await this.access.checkProjectForWrite(tx, {
      actorUserId: actorId,
      projectId,
    });
    if (project.kind === "not-found") throw missing();
    if (!project.resource.isSystemAdmin)
      throw new RecordDraftError(403, "ADMIN_REQUIRED", "仅管理员可以操作");
    const record = await this.identities.identity(tx, projectId, recordId);
    if (!record || !["PUBLISHED", "VOID"].includes(record.status))
      throw missing();
    // Replay exposes only identity and the original status; archived parents remain readable.
  }
  async transition(
    tx: TransactionContext,
    actorId: number,
    projectId: number,
    recordId: number,
    expectedVersion: number,
    restore: boolean,
    input: unknown,
    requestId: string,
    reauthorize: () => Promise<number>,
  ) {
    const parsed =
      schemaRegistry.RecordLifecycleRequest.schema.safeParse(input);
    if (!parsed.success)
      throw new RecordDraftError(
        422,
        "RECORD_REASON_REQUIRED",
        "请填写非空原因",
      );
    const project = await this.access.checkProjectForWrite(tx, {
      actorUserId: actorId,
      projectId,
    });
    if (project.kind === "not-found") throw missing();
    if (!project.resource.isSystemAdmin)
      throw new RecordDraftError(403, "ADMIN_REQUIRED", "仅管理员可以操作");
    const before = await this.identities.identity(tx, projectId, recordId);
    if (!before) throw missing();
    const module = await this.modules.checkModuleForWrite(tx, {
      projectId,
      moduleId: before.moduleId,
    });
    if (module.kind === "not-found") throw missing();
    if (project.kind !== "allowed" || module.kind !== "allowed")
      throw new RecordDraftError(
        409,
        "RECORD_PARENT_ARCHIVED",
        "项目或模块已归档，记录只读",
      );
    if (before.featureId !== null) {
      const feature = await this.features.checkFeatureForWrite(tx, {
        projectId,
        moduleId: before.moduleId,
        featureId: before.featureId,
      });
      if (feature.kind === "not-found") throw missing();
      if (feature.kind !== "allowed")
        throw new RecordDraftError(
          409,
          "RECORD_PARENT_ARCHIVED",
          "所属功能已归档，记录只读",
        );
    }
    const locked = await this.identities.identity(
      tx,
      projectId,
      recordId,
      true,
    );
    if (!locked) throw missing();
    if (
      locked.moduleId !== before.moduleId ||
      locked.featureId !== before.featureId ||
      locked.status !== (restore ? "VOID" : "PUBLISHED") ||
      locked.rowVersion !== expectedVersion
    )
      throw conflict();
    if ((await reauthorize()) !== actorId)
      throw new RecordDraftError(403, "ADMIN_REQUIRED", "当前管理员身份已变化");
    if (
      !(await this.repository.transition(
        tx,
        projectId,
        recordId,
        expectedVersion,
        restore,
        parsed.data.reason,
      ))
    )
      throw conflict();
    const after = restore
      ? await this.records.find(tx, projectId, recordId)
      : await this.records.findVoided(tx, projectId, recordId);
    if (!after) throw conflict();
    const action = restore ? "CHANGE_RECORD_RESTORED" : "CHANGE_RECORD_VOIDED";
    const event = await this.audit.append(tx, {
      projectId,
      actorType: "USER",
      actorId,
      action,
      targetType: "CHANGE_RECORD",
      targetId: String(recordId),
      eventPayload: {
        before: { status: locked.status, rowVersion: locked.rowVersion },
        after: { status: after.status, rowVersion: after.rowVersion },
        reason: parsed.data.reason,
      },
      requestId,
    });
    const visibility = {
      projectId,
      sourceEntityType: "CHANGE_RECORD" as const,
      sourceEntityId: recordId,
      visibilityScope: restore ? ("MEMBER" as const) : ("ADMIN_ONLY" as const),
      sourceStatus: after.status,
      sourceRowVersion: after.rowVersion,
    };
    await this.activity.updateEntityVisibility(tx, visibility);
    await this.activity.append(tx, {
      ...visibility,
      sourceChainId: event.chainId,
      sourceSequence: event.sequenceNo,
      activityType: action,
      actorId,
      summary: `${restore ? "恢复" : "作废"}迭代记录：${after.title}`,
      metadata: {
        recordId,
        moduleId: after.moduleId,
        featureId: after.featureId,
        version: after.currentVersion,
      },
      occurredAt: new Date(after.updatedAt),
    });
    await this.search.upsert(tx, {
      ...validatePublishedRecordSearch(after),
      visibilityScope: visibility.visibilityScope,
      sourceStatus: after.status,
    });
    return schemaRegistry.RecordLifecycleResult.schema.parse({
      id: after.id,
      projectId: after.projectId,
      status: after.status,
      rowVersion: after.rowVersion,
    });
  }
}
