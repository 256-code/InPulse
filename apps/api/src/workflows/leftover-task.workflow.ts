import { Inject, Injectable } from "@nestjs/common";
import {
  schemaRegistry,
  type LeftoverTaskRequest,
  type PublishedRecord,
} from "@inpulse/api-contract";
import type { TransactionContext } from "../database/transaction-context.js";
import {
  PROJECT_ACCESS_QUERY_PORT,
  type ProjectAccessQueryPort,
} from "../modules/projects/index.js";
import { ModuleQueryPort } from "../modules/modules/index.js";
import {
  FeatureQueryPort,
  FeatureReadPort,
} from "../modules/features/index.js";
import {
  TaskQueryPort,
  FollowupTaskCommandPort,
} from "../modules/tasks/index.js";
import {
  LeftoverRecordCommandPort,
  LeftoverSearchProjectionSync,
  RecordDraftError,
} from "../modules/change-records/index.js";
import { AuditWritePort } from "../audit/index.js";
import { ActivityWritePort } from "../modules/activity/index.js";
import { SearchProjectionWritePort } from "../modules/search/index.js";
export class LeftoverTaskError extends RecordDraftError {
  constructor(
    status: 404 | 409 | 422,
    code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(status, code, message);
  }
}
const missing = () =>
  new LeftoverTaskError(
    404,
    "LEFTOVER_NOT_FOUND",
    "记录、遗留项或任务不存在或无法访问",
  );
const archived = () =>
  new LeftoverTaskError(
    409,
    "LEFTOVER_PARENT_ARCHIVED",
    "所属项目、模块或功能已归档",
  );
@Injectable()
export class LeftoverTaskWorkflow {
  constructor(
    @Inject(PROJECT_ACCESS_QUERY_PORT)
    private readonly access: ProjectAccessQueryPort,
    @Inject(ModuleQueryPort) private readonly modules: ModuleQueryPort,
    @Inject(FeatureQueryPort) private readonly features: FeatureQueryPort,
    @Inject(FeatureReadPort) private readonly featureRead: FeatureReadPort,
    @Inject(TaskQueryPort) private readonly tasks: TaskQueryPort,
    @Inject(FollowupTaskCommandPort)
    private readonly createTask: FollowupTaskCommandPort,
    @Inject(LeftoverRecordCommandPort)
    private readonly records: LeftoverRecordCommandPort,
    @Inject(AuditWritePort) private readonly audit: AuditWritePort,
    @Inject(ActivityWritePort) private readonly activity: ActivityWritePort,
    @Inject(SearchProjectionWritePort)
    private readonly search: SearchProjectionWritePort,
    @Inject(LeftoverSearchProjectionSync)
    private readonly leftovers: LeftoverSearchProjectionSync,
  ) {}
  async authorize(
    tx: TransactionContext,
    actorId: number,
    projectId: number,
    writable = true,
  ) {
    const check = await this.access.checkProjectForWrite(tx, {
      actorUserId: actorId,
      projectId,
    });
    if (check.kind === "not-found") throw missing();
    if (writable && check.kind === "parent-not-active") throw archived();
  }
  private async prepare(
    tx: TransactionContext,
    actorId: number,
    p: number,
    r: number,
    resultImpacts: number[] = [],
  ) {
    await this.authorize(tx, actorId, p);
    for (let attempt = 0; attempt < 3; attempt++) {
      await tx.sql`SAVEPOINT leftover_parent_locks`;
      const before = await this.records.find(tx, p, r);
      if (!before) throw missing();
      const module = await this.modules.checkModuleForWrite(tx, before);
      if (module.kind === "not-found") throw missing();
      if (module.kind === "parent-not-active") throw archived();
      const inherited: { id: number; name: string }[] = [],
        excluded: { id: number; name: string }[] = [];
      const ids = [
        ...new Set([
          ...(before.featureId === null
            ? before.impactFeatureIds
            : [before.featureId]),
          ...resultImpacts,
        ]),
      ].sort((a, b) => a - b);
      for (const id of ids) {
        const check = await this.features.checkFeatureForWrite(tx, {
          projectId: p,
          moduleId: before.moduleId,
          featureId: id,
        });
        if (check.kind === "not-found") throw missing();
        if (check.kind === "parent-not-active" && id === before.featureId)
          throw archived();
        const feature = await this.featureRead.find(tx, p, before.moduleId, id);
        if (!feature) throw missing();
        if (before.featureId === null && before.impactFeatureIds.includes(id))
          (feature.status === "ACTIVE" ? inherited : excluded).push({
            id,
            name: feature.name,
          });
      }
      const record = await this.records.lock(tx, p, r);
      if (!record) throw missing();
      if (
        record.moduleId !== before.moduleId ||
        record.featureId !== before.featureId ||
        JSON.stringify(record.impactFeatureIds) !==
          JSON.stringify(before.impactFeatureIds)
      ) {
        await tx.sql`ROLLBACK TO SAVEPOINT leftover_parent_locks`;
        await tx.sql`RELEASE SAVEPOINT leftover_parent_locks`;
        continue;
      }
      const item = record.leftoverItem
        ? await this.records.lockItem(tx, p, r, record.leftoverItem.id)
        : undefined;
      if (!item) throw missing();
      await tx.sql`RELEASE SAVEPOINT leftover_parent_locks`;
      return { record, item, inherited, excluded };
    }
    throw new LeftoverTaskError(
      409,
      "LEFTOVER_SCOPE_CONFLICT",
      "记录影响集合已变化，请刷新确认",
    );
  }
  private async taskReference(
    tx: TransactionContext,
    actorId: number,
    record: PublishedRecord,
    taskId: number,
  ) {
    const task = await this.tasks.find(tx, record.projectId, taskId);
    if (
      !task ||
      task.moduleId !== record.moduleId ||
      task.featureId !== record.featureId
    )
      throw missing();
    await this.authorize(tx, actorId, task.projectId, false);
    return {
      projectId: task.projectId,
      moduleId: task.moduleId,
      featureId: task.featureId,
      taskId,
    };
  }
  async preview(tx: TransactionContext, actorId: number, p: number, r: number) {
    const { record, item, inherited, excluded } = await this.prepare(
      tx,
      actorId,
      p,
      r,
    );
    return {
      recordId: r,
      recordVersion: record.currentVersion,
      rowVersion: record.rowVersion,
      leftoverItemId: item.id,
      leftoverRowVersion: item.rowVersion,
      status: item.status,
      content: record.leftovers.find((l) => l.id === item.id)?.content ?? "",
      inheritedImpacts: inherited,
      excludedImpacts: excluded,
      linkedTask:
        item.linkedTaskId === null
          ? null
          : await this.taskReference(tx, actorId, record, item.linkedTaskId),
    };
  }
  async execute(
    tx: TransactionContext,
    actorId: number,
    p: number,
    r: number,
    input: LeftoverTaskRequest,
    requestId: string,
  ) {
    const { record, item, inherited } = await this.prepare(tx, actorId, p, r);
    if (item.id !== input.leftoverItemId) throw missing();
    if (item.linkedTaskId !== null)
      throw new LeftoverTaskError(
        409,
        "LEFTOVER_ALREADY_CONVERTED",
        "遗留项已转为任务",
        {
          task: await this.taskReference(
            tx,
            actorId,
            record,
            item.linkedTaskId,
          ),
        },
      );
    const content = record.leftovers.find((l) => l.id === item.id)?.content;
    if (
      record.currentVersion !== input.recordVersion ||
      record.rowVersion !== input.expectedRowVersion ||
      item.rowVersion !== input.leftoverExpectedRowVersion
    )
      throw new LeftoverTaskError(
        409,
        "LEFTOVER_VERSION_CONFLICT",
        "记录或遗留项版本已变化，请刷新确认",
      );
    if (item.status !== "ACTIVE" || !content)
      throw new LeftoverTaskError(
        409,
        "LEFTOVER_NOT_ACTIVE",
        "当前正式版本没有可转换的遗留问题",
      );
    const impactFeatureIds = inherited.map((f) => f.id);
    if (
      JSON.stringify(
        [...input.expectedImpactFeatureIds].sort((a, b) => a - b),
      ) !== JSON.stringify(impactFeatureIds)
    )
      throw new LeftoverTaskError(
        409,
        "LEFTOVER_IMPACTS_CHANGED",
        "继承的影响功能已变化，请刷新预览并确认",
      );
    const task = await this.createTask.create(
      tx,
      actorId,
      {
        projectId: p,
        moduleId: record.moduleId,
        featureId: record.featureId,
        impactFeatureIds,
      },
      {
        title: input.title,
        assigneeId: input.assigneeId,
        priority: input.priority,
        dueAt: input.dueAt,
        description: `来源记录：${record.code} v${record.currentVersion}\n遗留项 #${item.id}\n\n${content}`,
      },
      requestId,
    );
    await this.records.convert(tx, record, item, task.id, actorId);
    const event = await this.audit.append(tx, {
      projectId: p,
      actorType: "USER",
      actorId,
      action: "leftover.convert",
      targetType: "CHANGE_RECORD",
      targetId: String(r),
      eventPayload: {
        recordId: r,
        recordVersion: record.currentVersion,
        leftoverItemId: item.id,
        taskId: task.id,
        contentSnapshot: content,
        sourceImpactFeatureIds: record.impactFeatureIds,
        inheritedImpactFeatureIds: impactFeatureIds,
        before: { status: item.status, rowVersion: item.rowVersion },
        after: { status: "CONVERTED", rowVersion: item.rowVersion + 1 },
      },
      requestId,
    });
    await this.activity.append(tx, {
      projectId: p,
      sourceChainId: event.chainId,
      sourceSequence: event.sequenceNo,
      sourceEntityType: "CHANGE_RECORD",
      sourceEntityId: r,
      activityType: "leftover.convert",
      actorId,
      summary: `遗留问题已转任务：${task.title}`,
      metadata: { recordId: r, taskId: task.id, leftoverItemId: item.id },
      visibilityScope: "MEMBER",
      sourceStatus: "PUBLISHED",
      sourceRowVersion: record.rowVersion + 1,
      occurredAt: new Date(task.createdAt),
    });
    await this.search.upsert(tx, {
      projectId: p,
      entityType: "CHANGE_RECORD",
      entityId: r,
      title: record.title,
      summary: record.changeSolution.slice(0, 5000),
      rawText: [
        record.code,
        record.title,
        record.contextProblem,
        record.changeSolution,
        record.resultVerification,
        record.remainingIssues,
      ].join("\n"),
      visibilityScope: "MEMBER",
      sourceStatus: "PUBLISHED",
      sourceRowVersion: record.rowVersion + 1,
    });
    await this.leftovers.syncRecord(tx, record);
    return {
      projectId: p,
      moduleId: record.moduleId,
      featureId: record.featureId,
      taskId: task.id,
      recordId: r,
      leftoverItemId: item.id,
      recordVersion: record.currentVersion,
      recordRowVersion: record.rowVersion + 1,
      leftoverRowVersion: item.rowVersion + 1,
      impactFeatureIds,
    };
  }
  async replay(
    tx: TransactionContext,
    actorId: number,
    p: number,
    r: number,
    context: unknown,
  ) {
    const saved =
      schemaRegistry.LeftoverTaskReplayContext.schema.parse(context);
    if (saved.projectId !== p || saved.recordId !== r) throw missing();
    const { record, item } = await this.prepare(
      tx,
      actorId,
      p,
      r,
      saved.impactFeatureIds,
    );
    if (
      item.id !== saved.leftoverItemId ||
      item.status !== "CONVERTED" ||
      item.linkedTaskId !== saved.taskId ||
      record.moduleId !== saved.moduleId ||
      record.featureId !== saved.featureId
    )
      throw missing();
    await this.taskReference(tx, actorId, record, saved.taskId);
    await this.createTask.replay(tx, actorId, saved, saved.taskId);
  }
  async source(tx: TransactionContext, actorId: number, taskId: number) {
    const task = await this.tasks.findByTaskId(tx, taskId);
    if (!task) throw missing();
    await this.authorize(tx, actorId, task.projectId, false);
    const source = await this.records.source(tx, task.projectId, taskId);
    if (source) {
      const record = await this.records.find(
        tx,
        source.projectId,
        source.recordId,
      );
      if (!record) throw missing();
      await this.taskReference(tx, actorId, record, taskId);
    }
    return { source };
  }
}
