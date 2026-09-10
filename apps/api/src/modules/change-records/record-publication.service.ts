import { Inject, Injectable } from "@nestjs/common";
import {
  publishedRecordContentSchema,
  recordPublicationReplayContextSchema,
  type RecordDraftContent,
  type PublishedRecordContent,
} from "@inpulse/api-contract";
import type { TransactionContext } from "../../database/transaction-context.js";
import { ProjectCodePort } from "../projects/index.js";
import { FeatureReadPort } from "../features/index.js";
import { RecordDraftRepository } from "./record-draft.repository.js";
import { PublishedRecordRepository } from "./published-record.repository.js";
import {
  RecordPublicationRepository,
  type PublicationIdentity,
} from "./record-publication.repository.js";
import { RecordPublicationAccess } from "./record-publication-access.js";
import {
  RecordPublicationEffects,
  validatePublishedRecordSearch,
} from "./record-publication-effects.js";
import { RecordDraftError } from "./record-drafts.service.js";
import type { RecordPublicationCommandPort } from "./record-publication.port.js";
@Injectable()
export class RecordPublicationService implements RecordPublicationCommandPort {
  constructor(
    @Inject(RecordPublicationAccess)
    private readonly access: RecordPublicationAccess,
    @Inject(RecordPublicationRepository)
    private readonly repository: RecordPublicationRepository,
    @Inject(RecordDraftRepository)
    private readonly drafts: RecordDraftRepository,
    @Inject(PublishedRecordRepository)
    private readonly published: PublishedRecordRepository,
    @Inject(ProjectCodePort) private readonly codes: ProjectCodePort,
    @Inject(FeatureReadPort) private readonly features: FeatureReadPort,
    @Inject(RecordPublicationEffects)
    private readonly effects: RecordPublicationEffects,
  ) {}
  private conflict() {
    return new RecordDraftError(
      409,
      "RECORD_VERSION_CONFLICT",
      "记录版本已变化，请加载最新内容后合并",
    );
  }
  private content(input: RecordDraftContent): RecordDraftContent {
    const {
      title,
      contextProblem,
      changeSolution,
      resultVerification,
      remainingIssues,
    } = input;
    return {
      title,
      contextProblem,
      changeSolution,
      resultVerification,
      remainingIssues,
    };
  }
  private validate(input: PublishedRecordContent) {
    const parsed = publishedRecordContentSchema.safeParse(input);
    if (!parsed.success)
      throw new RecordDraftError(
        422,
        "RECORD_PUBLICATION_VALIDATION_FAILED",
        "请检查必填内容；发布和正式修订的遗留问题最多10000字符。草稿和输入已保留。",
      );
    return parsed.data;
  }
  async publish(
    tx: TransactionContext,
    actorId: number,
    projectId: number,
    recordId: number,
    expectedRowVersion: number,
    requestId: string,
  ) {
    const { record, source } = await this.access.prepare(
      tx,
      actorId,
      projectId,
      recordId,
      true,
    );
    if (record.rowVersion !== expectedRowVersion) throw this.conflict();
    const before = await this.drafts.find(tx, projectId, recordId);
    if (!before) throw this.conflict();
    const input = this.validate({
      ...this.content(before),
      confirmLeftoverResolved: false,
    });
    const code = await this.codes.allocateChangeRecordCode(tx, projectId);
    validatePublishedRecordSearch({ ...before, ...input, code });
    const after = await this.save(tx, actorId, record, input, code);
    const recipients = [
      after.authorId,
      after.handlerId,
      ...(source ? [source.assigneeId] : []),
    ];
    for (const featureId of after.featureId === null
      ? after.impactFeatureIds
      : [after.featureId]) {
      const feature = await this.features.find(
        tx,
        projectId,
        after.moduleId,
        featureId,
      );
      if (!feature)
        throw new RecordDraftError(
          404,
          "RECORD_FEATURE_NOT_FOUND",
          "所属功能不存在或无法访问",
        );
      recipients.push(feature.createdBy);
    }
    await this.effects.append(
      tx,
      actorId,
      before,
      after,
      "PUBLISH",
      requestId,
      recipients,
    );
    return after;
  }
  async update(
    tx: TransactionContext,
    actorId: number,
    projectId: number,
    recordId: number,
    rowVersion: number,
    currentVersion: number,
    input: PublishedRecordContent,
    requestId: string,
  ) {
    const { record } = await this.access.prepare(
      tx,
      actorId,
      projectId,
      recordId,
      false,
    );
    if (
      record.rowVersion !== rowVersion ||
      record.currentVersion !== currentVersion
    )
      throw this.conflict();
    const before = await this.published.find(tx, projectId, recordId);
    if (!before) throw this.conflict();
    const validated = this.validate(input);
    validatePublishedRecordSearch({ ...before, ...validated });
    const after = await this.save(tx, actorId, record, validated, before.code);
    const assignee = await this.access.taskAssignee(tx, record);
    await this.effects.append(tx, actorId, before, after, "UPDATE", requestId, [
      before.authorId,
      ...(assignee === undefined ? [] : [assignee]),
    ]);
    return after;
  }
  private async save(
    tx: TransactionContext,
    actorId: number,
    record: PublicationIdentity,
    input: PublishedRecordContent,
    code: string,
  ) {
    const items = await this.repository.leftovers(
      tx,
      record.projectId,
      record.id,
    );
    if (items.length > 1)
      throw new RecordDraftError(
        409,
        "RECORD_LEFTOVER_CONFLICT",
        "记录存在多条遗留项，需要先确认其历史关联",
      );
    let item = items[0];
    if (
      item?.status === "ACTIVE" &&
      !input.remainingIssues &&
      !input.confirmLeftoverResolved
    )
      throw new RecordDraftError(
        422,
        "LEFTOVER_RESOLUTION_CONFIRMATION_REQUIRED",
        "清空未转换的遗留问题前，请明确确认问题已解决",
      );
    if (input.remainingIssues && !item)
      item = await this.repository.createLeftover(
        tx,
        record.projectId,
        record.id,
        actorId,
      );
    if (item && item.status !== "CONVERTED") {
      const target = input.remainingIssues ? "ACTIVE" : "RESOLVED";
      if (
        item.status !== target &&
        !(await this.repository.setLeftoverStatus(
          tx,
          record.projectId,
          record.id,
          item,
          target,
        ))
      )
        throw this.conflict();
    }
    if (
      !(await this.repository.writeVersion(
        tx,
        record,
        actorId,
        this.content(input),
        code,
        input.remainingIssues ? item!.id : null,
      ))
    )
      throw this.conflict();
    const result = await this.published.find(tx, record.projectId, record.id);
    if (!result) throw this.conflict();
    return result;
  }
  async replay(tx: TransactionContext, actorId: number, context: unknown) {
    const saved = recordPublicationReplayContextSchema.parse(context);
    const { record } = await this.access.prepare(
      tx,
      actorId,
      saved.projectId,
      saved.recordId,
      false,
    );
    if (
      record.moduleId !== saved.moduleId ||
      record.featureId !== saved.featureId ||
      record.taskId !== saved.taskId ||
      JSON.stringify(record.impactFeatureIds) !==
        JSON.stringify(saved.impactFeatureIds)
    )
      throw this.conflict();
    const items = await this.repository.leftovers(
      tx,
      saved.projectId,
      saved.recordId,
    );
    if (
      saved.leftoverItemIds.some((id) => !items.some((item) => item.id === id))
    )
      throw new RecordDraftError(
        404,
        "RECORD_LEFTOVER_NOT_FOUND",
        "遗留项不存在或无法访问",
      );
  }
}
