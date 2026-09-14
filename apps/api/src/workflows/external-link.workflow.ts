import { Inject, Injectable } from "@nestjs/common";
import {
  schemaRegistry,
  type ExternalLinkTargetType,
} from "@inpulse/api-contract";
import type { TransactionContext } from "../database/transaction-context.js";
import type {
  LinkTargetQueryPort,
  LinkTargetCommandPort,
} from "../modules/external-links/link-target.port.js";
import {
  ProjectLinkQueryPort,
  ProjectLinkCommandPort,
} from "../modules/projects/external-link-target.port.js";
import {
  FeatureLinkQueryPort,
  FeatureLinkCommandPort,
} from "../modules/features/external-link-target.port.js";
import {
  TaskLinkQueryPort,
  TaskLinkCommandPort,
} from "../modules/tasks/external-link-target.port.js";
import {
  RecordLinkQueryPort,
  RecordLinkCommandPort,
} from "../modules/change-records/external-link-target.port.js";
import {
  PROJECT_ACCESS_QUERY_PORT,
  type ProjectAccessQueryPort,
} from "../modules/projects/index.js";
import { ModuleQueryPort } from "../modules/modules/index.js";
import { FeatureQueryPort } from "../modules/features/index.js";
import {
  ExternalLinksQueryPort,
  ExternalLinksCommandPort,
} from "../modules/external-links/index.js";
import { AuditWritePort } from "../audit/index.js";
import { ActivityWritePort } from "../modules/activity/index.js";
import { ExternalLinkSearchPort } from "../modules/search/external-link-search.port.js";
export class ExternalLinkError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
const missing = () =>
  new ExternalLinkError(
    404,
    "EXTERNAL_LINK_NOT_FOUND",
    "目标或关联不存在或无法访问",
  );
const conflict = () =>
  new ExternalLinkError(
    409,
    "EXTERNAL_LINK_VERSION_CONFLICT",
    "目标状态或版本已变化，请重新加载",
  );
@Injectable()
export class ExternalLinkWorkflow {
  private readonly queries: Record<ExternalLinkTargetType, LinkTargetQueryPort>;
  private readonly commands: Record<
    ExternalLinkTargetType,
    LinkTargetCommandPort
  >;
  constructor(
    @Inject(PROJECT_ACCESS_QUERY_PORT)
    private readonly access: ProjectAccessQueryPort,
    @Inject(ModuleQueryPort) private readonly modules: ModuleQueryPort,
    @Inject(FeatureQueryPort) private readonly features: FeatureQueryPort,
    @Inject(ProjectLinkQueryPort) project: ProjectLinkQueryPort,
    @Inject(FeatureLinkQueryPort) feature: FeatureLinkQueryPort,
    @Inject(TaskLinkQueryPort) task: TaskLinkQueryPort,
    @Inject(RecordLinkQueryPort) record: RecordLinkQueryPort,
    @Inject(ProjectLinkCommandPort) projectCommand: ProjectLinkCommandPort,
    @Inject(FeatureLinkCommandPort) featureCommand: FeatureLinkCommandPort,
    @Inject(TaskLinkCommandPort) taskCommand: TaskLinkCommandPort,
    @Inject(RecordLinkCommandPort) recordCommand: RecordLinkCommandPort,
    @Inject(ExternalLinksQueryPort)
    private readonly links: ExternalLinksQueryPort,
    @Inject(ExternalLinksCommandPort)
    private readonly linkCommands: ExternalLinksCommandPort,
    @Inject(AuditWritePort) private readonly audit: AuditWritePort,
    @Inject(ActivityWritePort) private readonly activity: ActivityWritePort,
    @Inject(ExternalLinkSearchPort)
    private readonly search: ExternalLinkSearchPort,
  ) {
    this.queries = {
      PROJECT: project,
      FEATURE: feature,
      TASK: task,
      CHANGE_RECORD: record,
    };
    this.commands = {
      PROJECT: projectCommand,
      FEATURE: featureCommand,
      TASK: taskCommand,
      CHANGE_RECORD: recordCommand,
    };
  }
  async target(
    tx: TransactionContext,
    actor: number,
    type: ExternalLinkTargetType,
    id: number,
    write = false,
  ) {
    const query = this.queries[type];
    // PROJECT commands acquire UPDATE before the authorization SHARE lock: no shared-lock upgrade race.
    const before = await query.find(
      tx,
      id,
      write && type === "PROJECT" ? "update" : undefined,
    );
    if (!before) throw missing();
    const project = await this.access.checkProjectForWrite(tx, {
      actorUserId: actor,
      projectId: before.projectId,
    });
    if (project.kind === "not-found") throw missing();
    let writable = project.kind === "allowed";
    if (before.moduleId !== null) {
      const module = await this.modules.checkModuleForWrite(tx, {
        projectId: before.projectId,
        moduleId: before.moduleId,
      });
      if (module.kind === "not-found") throw missing();
      writable = writable && module.kind === "allowed";
    }
    if (before.featureId !== null && type !== "FEATURE") {
      const feature = await this.features.checkFeatureForWrite(tx, {
        projectId: before.projectId,
        moduleId: before.moduleId!,
        featureId: before.featureId,
      });
      if (feature.kind === "not-found") throw missing();
      writable = writable && feature.kind === "allowed";
    }
    // Parent waits can invalidate the pre-read. Lock and re-read every target,
    // including GET/replay, then retain that lock through result authorization.
    const current = await query.find(tx, id, write ? "update" : "share");
    if (!current) throw missing();
    if (
      current.projectId !== before.projectId ||
      current.moduleId !== before.moduleId ||
      current.featureId !== before.featureId
    )
      throw conflict();
    if (
      type === "CHANGE_RECORD" &&
      current.status === "VOID" &&
      !project.resource.isSystemAdmin
    )
      throw missing();
    writable =
      writable &&
      (type === "CHANGE_RECORD"
        ? ["DRAFT", "PUBLISHED"].includes(current.status)
        : current.status === "ACTIVE");
    if (write && !writable)
      throw new ExternalLinkError(
        409,
        "EXTERNAL_LINK_READ_ONLY",
        "目标或所属父级只读，不能修改关联",
      );
    // Refresh membership after potentially waiting for a target lock.
    if (
      write &&
      (
        await this.access.checkProjectForWrite(tx, {
          actorUserId: actor,
          projectId: current.projectId,
        })
      ).kind === "not-found"
    )
      throw missing();
    return { target: current, writable };
  }
  async list(
    tx: TransactionContext,
    actor: number,
    type: ExternalLinkTargetType,
    id: number,
  ) {
    const { target, writable } = await this.target(tx, actor, type, id);
    return {
      projectId: target.projectId,
      rowVersion: target.rowVersion,
      writable,
      items: await this.links.list(tx, target.projectId, type, id),
    };
  }
  async replay(
    tx: TransactionContext,
    actor: number,
    type: ExternalLinkTargetType,
    id: number,
    context: unknown,
  ) {
    const value =
      schemaRegistry.ExternalLinkReplayContext.schema.parse(context);
    if (value.targetType !== type || value.targetId !== id) throw missing();
    const { target } = await this.target(tx, actor, type, id);
    if (
      target.projectId !== value.projectId ||
      !(await this.links.exists(tx, target.projectId, value.linkId))
    )
      throw missing();
  }
  async mutate(
    tx: TransactionContext,
    actor: number,
    type: ExternalLinkTargetType,
    id: number,
    version: number,
    input: { url: string } | { linkId: number },
    requestId: string,
    reauthorize: () => Promise<number>,
  ) {
    const { target } = await this.target(tx, actor, type, id, true);
    if (target.rowVersion !== version) throw conflict();
    if ((await reauthorize()) !== actor)
      throw new ExternalLinkError(401, "SESSION_REQUIRED", "登录状态已失效");
    const adding = "url" in input;
    const result = adding
      ? await this.linkCommands.add(
          tx,
          target.projectId,
          type,
          id,
          actor,
          input.url,
        )
      : await this.linkCommands.remove(
          tx,
          target.projectId,
          type,
          id,
          input.linkId,
        );
    if (!result) throw missing();
    if (!result.changed)
      throw new ExternalLinkError(
        409,
        "EXTERNAL_LINK_ALREADY_ASSOCIATED",
        "该链接已关联，请勿重复添加",
      );
    if (!(await this.commands[type].advance(tx, target))) throw conflict();
    const rowVersion = version + 1;
    const event = await this.audit.append(tx, {
      projectId: target.projectId,
      actorType: "USER",
      actorId: actor,
      action: adding ? "EXTERNAL_LINK_ADDED" : "EXTERNAL_LINK_REMOVED",
      targetType: type,
      targetId: String(id),
      eventPayload: {
        targetType: type,
        targetId: id,
        linkId: result.linkId,
        normalizedUrl: result.url,
        before: { associated: !adding, rowVersion: version },
        after: { associated: adding, rowVersion },
      },
      requestId,
    });
    // Activity contains no URL or content; F21 changes visibility for this source identity.
    await this.activity.append(tx, {
      projectId: target.projectId,
      sourceChainId: event.chainId,
      sourceSequence: event.sequenceNo,
      sourceEntityType: type,
      sourceEntityId: id,
      activityType: adding ? "EXTERNAL_LINK_ADDED" : "EXTERNAL_LINK_REMOVED",
      actorId: actor,
      summary: adding ? "添加 GitHub 关联" : "解除 GitHub 关联",
      metadata: { linkId: result.linkId },
      visibilityScope: "MEMBER",
      sourceStatus: target.status,
      sourceRowVersion: rowVersion,
      occurredAt: new Date(),
    });
    await this.search.refresh(tx, target.projectId, type, id, rowVersion);
    return {
      projectId: target.projectId,
      targetType: type,
      targetId: id,
      linkId: result.linkId,
      rowVersion,
    };
  }
}
