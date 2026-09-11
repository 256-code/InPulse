import { Inject, Injectable } from "@nestjs/common";
import type {
  PublishedRecord,
  RecordDraftItem,
  RecordDraftContent,
} from "@inpulse/api-contract";
import { AuditWritePort } from "../../audit/index.js";
import type { TransactionContext } from "../../database/transaction-context.js";
import {
  PROJECT_ACCESS_QUERY_PORT,
  type ProjectAccessQueryPort,
} from "../projects/index.js";
import { ActivityWritePort } from "../activity/index.js";
import { NotificationWritePort } from "../notifications/index.js";
import {
  SearchProjectionWritePort,
  validateSearchProjectionWriteInput,
  SearchProjectionWriteValidationError,
  type SearchProjectionWriteInput,
} from "../search/index.js";
import { RecordDraftError } from "./record-drafts.service.js";
import { LeftoverSearchProjectionSync } from "./leftover-search-projection.js";
type SearchRecord = RecordDraftContent & {
  id: number;
  projectId: number;
  code: string;
  rowVersion: number;
};
export function validatePublishedRecordSearch(
  record: SearchRecord,
): SearchProjectionWriteInput {
  const input: SearchProjectionWriteInput = {
    projectId: record.projectId,
    entityType: "CHANGE_RECORD",
    entityId: record.id,
    title: record.title,
    summary: record.contextProblem.slice(0, 5000),
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
    sourceRowVersion: record.rowVersion,
  };
  try {
    validateSearchProjectionWriteInput(input);
  } catch (error) {
    if (error instanceof SearchProjectionWriteValidationError)
      throw new RecordDraftError(
        422,
        "RECORD_SEARCH_CAPACITY_EXCEEDED",
        "内容过长，超出发布容量。请缩短正文后重试；草稿和输入已保留。",
      );
    throw error;
  }
  return input;
}
@Injectable()
export class RecordPublicationEffects {
  constructor(
    @Inject(AuditWritePort) private readonly audit: AuditWritePort,
    @Inject(ActivityWritePort) private readonly activity: ActivityWritePort,
    @Inject(SearchProjectionWritePort)
    private readonly search: SearchProjectionWritePort,
    @Inject(LeftoverSearchProjectionSync)
    private readonly leftovers: LeftoverSearchProjectionSync,
    @Inject(NotificationWritePort)
    private readonly notifications: NotificationWritePort,
    @Inject(PROJECT_ACCESS_QUERY_PORT)
    private readonly access: ProjectAccessQueryPort,
  ) {}
  async append(
    tx: TransactionContext,
    actorId: number,
    before: PublishedRecord | RecordDraftItem,
    after: PublishedRecord,
    kind: "PUBLISH" | "UPDATE",
    requestId: string,
    recipients: readonly number[],
  ) {
    const input = validatePublishedRecordSearch(after),
      action = kind === "PUBLISH" ? "record.publish" : "record.version.create";
    const event = await this.audit.append(tx, {
      projectId: after.projectId,
      actorType: "USER",
      actorId,
      action,
      targetType: "CHANGE_RECORD",
      targetId: String(after.id),
      eventPayload: { before, after },
      requestId,
    });
    await this.activity.append(tx, {
      projectId: after.projectId,
      sourceChainId: event.chainId,
      sourceSequence: event.sequenceNo,
      sourceEntityType: "CHANGE_RECORD",
      sourceEntityId: after.id,
      activityType: action,
      actorId,
      summary: `${kind === "PUBLISH" ? "发布" : "修订"}迭代记录：${after.title}`,
      metadata: {
        recordId: after.id,
        moduleId: after.moduleId,
        featureId: after.featureId,
        version: after.currentVersion,
      },
      visibilityScope: "MEMBER",
      sourceStatus: "PUBLISHED",
      sourceRowVersion: after.rowVersion,
      occurredAt: new Date(after.updatedAt),
    });
    await this.search.upsert(tx, input);
    await this.leftovers.syncRecord(tx, after);
    // Candidates come only from the application service's server-side source context.
    for (const recipientId of [...new Set(recipients)].sort((a, b) => a - b)) {
      const scope = await this.access.checkProjectForWrite(tx, {
        actorUserId: recipientId,
        projectId: after.projectId,
      });
      if (scope.kind !== "allowed") continue;
      await this.notifications.write(tx, {
        projectId: after.projectId,
        recipientId,
        sourceChainId: event.chainId,
        sourceSequence: event.sequenceNo,
        notificationType: action,
        title:
          `${kind === "PUBLISH" ? "发布" : "修订"}迭代记录：${after.title}`.slice(
            0,
            500,
          ),
        body: `${after.code} · v${after.currentVersion}`,
        targetPath: `/records?view=published&projectId=${after.projectId}&publishedId=${after.id}`,
        createdAt: new Date(after.updatedAt),
      });
    }
  }
}
