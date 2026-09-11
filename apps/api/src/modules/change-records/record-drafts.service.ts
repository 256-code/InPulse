import { Inject, Injectable } from "@nestjs/common";
import type {
  RecordDraftCommandPort,
  RecordDraftQueryPort,
  RecordSourceSnapshot,
} from "./record-draft.port.js";
import {
  RECORD_PAGE_LIMIT_DEFAULT,
  recordDraftReplayContextSchema,
  type IndependentRecordDraftRequest,
  type RecordDraftContent,
  type RecordDraftItem,
  type RecordDraftPage,
} from "@inpulse/api-contract";
import {
  TimeCursorError,
  TimeCursorService,
  type TimeCursorValue,
} from "../../cursors/time-cursor.js";
import { AuditWritePort } from "../../audit/index.js";
import { PostgresUnitOfWork } from "../../database/unit-of-work.js";
import type { TransactionContext } from "../../database/transaction-context.js";
import {
  PROJECT_ACCESS_QUERY_PORT,
  type ProjectAccessQueryPort,
} from "../projects/index.js";
import { ModuleQueryPort, ModuleReadPort } from "../modules/index.js";
import { FeatureQueryPort, FeatureReadPort } from "../features/index.js";
import {
  RecordDraftRepository,
  type DraftScope,
} from "./record-draft.repository.js";

const RECORD_DRAFT_LIST_NAMESPACE = "RECORD_DRAFTS";

/** B-1 草稿列表分页参数：limit 1..100 默认 20，cursor 为服务端签名游标。 */
export interface RecordDraftListCommand {
  readonly cursor?: string;
  readonly limit?: number;
}

export class RecordDraftError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 422,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
const missing = () =>
  new RecordDraftError(
    404,
    "RECORD_DRAFT_NOT_FOUND",
    "草稿或所属范围不存在或无法访问",
  );
@Injectable()
export class RecordDraftsService
  implements RecordDraftCommandPort, RecordDraftQueryPort
{
  constructor(
    @Inject(PROJECT_ACCESS_QUERY_PORT)
    private readonly access: ProjectAccessQueryPort,
    @Inject(ModuleQueryPort) private readonly modules: ModuleQueryPort,
    @Inject(ModuleReadPort) private readonly moduleRead: ModuleReadPort,
    @Inject(FeatureQueryPort) private readonly features: FeatureQueryPort,
    @Inject(FeatureReadPort) private readonly featureRead: FeatureReadPort,
    @Inject(RecordDraftRepository)
    private readonly repository: RecordDraftRepository,
    @Inject(PostgresUnitOfWork) private readonly uow: PostgresUnitOfWork,
    @Inject(AuditWritePort) private readonly audit: AuditWritePort,
    @Inject(TimeCursorService) private readonly cursor: TimeCursorService,
  ) {}
  /**
   * 草稿列表分页（B-1 / C-006）：items / nextCursor / hasMore；签名游标绑定
   * actor、命名空间与项目，15 分钟过期，失效统一 422；草稿详情读取不变。
   */
  async read(
    actorId: number,
    projectId: number,
    recordId?: number,
    page: RecordDraftListCommand = {},
  ): Promise<RecordDraftItem | RecordDraftPage> {
    const authorized = await this.access.getAuthorizedSearchScope(actorId);
    if (!authorized.projectIds.includes(projectId)) throw missing();
    if (recordId !== undefined)
      return this.uow.run(async (tx) => {
        const item = await this.repository.find(tx, projectId, recordId);
        if (!item) throw missing();
        return item;
      });
    const limit = page.limit ?? RECORD_PAGE_LIMIT_DEFAULT;
    const after = this.decodeListCursor(page.cursor, actorId, projectId);
    return this.uow.run(async (tx) => {
      const result = await this.repository.listPage(tx, {
        projectId,
        limit,
        after,
      });
      return {
        items: result.items,
        hasMore: result.hasMore,
        nextCursor:
          result.last === null
            ? null
            : this.cursor.encode({
                actorUserId: actorId,
                namespace: RECORD_DRAFT_LIST_NAMESPACE,
                projectId,
                afterAt: result.last.at,
                afterId: result.last.id,
              }),
      };
    });
  }
  private decodeListCursor(
    cursor: string | undefined,
    actorId: number,
    projectId: number,
  ): TimeCursorValue | null {
    try {
      return this.cursor.decode(cursor, {
        actorUserId: actorId,
        namespace: RECORD_DRAFT_LIST_NAMESPACE,
        projectId,
      });
    } catch (error) {
      if (error instanceof TimeCursorError)
        throw new RecordDraftError(
          422,
          "INVALID_CURSOR",
          "游标无效、已过期或与当前筛选条件不匹配",
        );
      throw error;
    }
  }
  async lockDraft(tx: TransactionContext, projectId: number, recordId: number) {
    // Re-read relationships in a separate READ COMMITTED statement after waiting for the row.
    const locked = await this.repository.find(tx, projectId, recordId, true);
    return locked ? this.repository.find(tx, projectId, recordId) : undefined;
  }
  async authorsForTask(
    tx: TransactionContext,
    projectId: number,
    taskId: number,
  ) {
    return this.repository.authorsForTask(tx, projectId, taskId);
  }
  async bindForCompletion(
    tx: TransactionContext,
    actorId: number,
    source: RecordSourceSnapshot,
    recordId: number,
    version: number,
    requestId: string,
  ) {
    const before = await this.lockDraft(tx, source.projectId, recordId);
    if (
      !before ||
      before.moduleId !== source.moduleId ||
      before.featureId !== source.featureId ||
      (before.taskId !== null && before.taskId !== source.taskId)
    )
      throw missing();
    if (before.rowVersion !== version)
      throw new RecordDraftError(
        409,
        "RECORD_VERSION_CONFLICT",
        "草稿版本已变化，请重新选择最新草稿",
      );
    if (before.taskId === source.taskId) return before;
    const after = await this.repository.bindSource(tx, before, source.taskId);
    if (!after)
      throw new RecordDraftError(
        409,
        "RECORD_VERSION_CONFLICT",
        "草稿关联或版本已变化",
      );
    await this.appendAudit(tx, actorId, before, after, requestId);
    return after;
  }
  async authorize(
    tx: TransactionContext,
    actorId: number,
    scope: DraftScope,
    existing = false,
  ) {
    const project = await this.access.checkProjectForWrite(tx, {
      actorUserId: actorId,
      projectId: scope.projectId,
    });
    if (project.kind === "not-found") throw missing();
    if (!(await this.moduleRead.find(tx, scope.projectId, scope.moduleId)))
      throw missing();
    if (
      scope.featureId !== null &&
      !(await this.featureRead.find(
        tx,
        scope.projectId,
        scope.moduleId,
        scope.featureId,
      ))
    )
      throw missing();
    const module = await this.modules.checkModuleForWrite(tx, scope);
    if (module.kind === "not-found") throw missing();
    if (
      project.kind === "parent-not-active" ||
      module.kind === "parent-not-active"
    )
      throw new RecordDraftError(
        409,
        "RECORD_PARENT_ARCHIVED",
        "项目或模块已归档，草稿只读",
      );
    for (const featureId of [
      ...new Set(
        scope.featureId === null ? scope.impactFeatureIds : [scope.featureId],
      ),
    ].sort((a, b) => a - b)) {
      const feature = await this.features.checkFeatureForWrite(tx, {
        projectId: scope.projectId,
        moduleId: scope.moduleId,
        featureId,
      });
      if (feature.kind === "not-found") throw missing();
      if (
        feature.kind === "parent-not-active" &&
        (scope.featureId !== null || !existing)
      )
        throw new RecordDraftError(
          409,
          "RECORD_PARENT_ARCHIVED",
          "所属功能已归档或影响功能不可新增，草稿只读",
        );
    }
  }
  async resolveExisting(
    tx: TransactionContext,
    actorId: number,
    projectId: number,
    recordId: number,
  ) {
    const project = await this.access.checkProjectForWrite(tx, {
      actorUserId: actorId,
      projectId,
    });
    if (project.kind === "not-found") throw missing();
    const before = await this.repository.find(tx, projectId, recordId);
    if (!before) throw missing();
    await this.authorize(tx, actorId, before, true);
    return before;
  }
  async create(
    tx: TransactionContext,
    actorId: number,
    projectId: number,
    moduleId: number,
    input: IndependentRecordDraftRequest,
    requestId: string,
  ) {
    const scope = {
      projectId,
      moduleId,
      featureId: input.scopeType === "FEATURE" ? input.featureId : null,
      impactFeatureIds:
        input.scopeType === "MODULE" ? input.impactFeatureIds : [],
    };
    await this.authorize(tx, actorId, scope);
    const after = await this.repository.create(
      tx,
      scope,
      actorId,
      this.content(input),
    );
    await this.appendAudit(tx, actorId, null, after, requestId);
    return after;
  }
  async update(
    tx: TransactionContext,
    actorId: number,
    projectId: number,
    recordId: number,
    version: number,
    content: RecordDraftContent,
    requestId: string,
  ) {
    const resource = await this.resolveExisting(
      tx,
      actorId,
      projectId,
      recordId,
    );
    if (resource.taskId !== null)
      throw new RecordDraftError(
        409,
        "RECORD_SOURCE_WORKFLOW_REQUIRED",
        "来源任务草稿必须通过关联流程编辑",
      );
    const before = await this.repository.find(tx, projectId, recordId, true);
    if (!before) throw missing();
    if (
      before.taskId !== null ||
      before.moduleId !== resource.moduleId ||
      before.featureId !== resource.featureId ||
      JSON.stringify(before.impactFeatureIds) !==
        JSON.stringify(resource.impactFeatureIds)
    )
      throw new RecordDraftError(
        409,
        "RECORD_SCOPE_CONFLICT",
        "草稿关联已变化，请重新加载",
      );
    if (before.rowVersion !== version)
      throw new RecordDraftError(
        409,
        "RECORD_VERSION_CONFLICT",
        "草稿版本已变化，请加载最新内容后合并",
      );
    const after = await this.repository.update(tx, before, content);
    if (!after)
      throw new RecordDraftError(
        409,
        "RECORD_VERSION_CONFLICT",
        "草稿版本已变化，请加载最新内容后合并",
      );
    await this.appendAudit(tx, actorId, before, after, requestId);
    return after;
  }
  async replay(tx: TransactionContext, actorId: number, context: unknown) {
    const saved = recordDraftReplayContextSchema.parse(context);
    await this.resolveExisting(tx, actorId, saved.projectId, saved.recordId);
    for (const featureId of saved.impactFeatureIds)
      if (
        !(await this.featureRead.find(
          tx,
          saved.projectId,
          saved.moduleId,
          featureId,
        ))
      )
        throw missing();
  }
  findDraft(tx: TransactionContext, projectId: number, recordId: number) {
    return this.repository.find(tx, projectId, recordId);
  }
  listForTask(tx: TransactionContext, projectId: number, taskId: number) {
    return this.repository.listForTask(tx, projectId, taskId);
  }
  async createFromTask(
    tx: TransactionContext,
    actorId: number,
    source: RecordSourceSnapshot,
    content: RecordDraftContent,
    requestId: string,
  ) {
    await this.authorize(tx, actorId, source, true);
    const after = await this.repository.create(
      tx,
      source,
      actorId,
      this.content(content),
      { taskId: source.taskId, handlerId: source.assigneeId },
    );
    await this.appendAudit(tx, actorId, null, after, requestId);
    return after;
  }
  async updateFromTask(
    tx: TransactionContext,
    actorId: number,
    source: RecordSourceSnapshot,
    recordId: number,
    version: number,
    content: RecordDraftContent,
    requestId: string,
  ) {
    const before = await this.repository.find(
      tx,
      source.projectId,
      recordId,
      true,
    );
    if (
      !before ||
      before.taskId !== source.taskId ||
      before.moduleId !== source.moduleId ||
      before.featureId !== source.featureId
    )
      throw missing();
    if (before.rowVersion !== version)
      throw new RecordDraftError(
        409,
        "RECORD_VERSION_CONFLICT",
        "草稿版本或关联已变化，请加载最新内容后合并",
      );
    // Workflow prelocked this record version's parents/impact set before locking the task.
    await this.authorize(tx, actorId, before, true);
    const after = await this.repository.update(
      tx,
      before,
      this.content(content),
    );
    if (!after)
      throw new RecordDraftError(
        409,
        "RECORD_VERSION_CONFLICT",
        "草稿版本已变化",
      );
    await this.appendAudit(tx, actorId, before, after, requestId);
    return after;
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
  private async appendAudit(
    tx: TransactionContext,
    actorId: number,
    before: RecordDraftItem | null,
    after: RecordDraftItem,
    requestId: string,
  ) {
    await this.audit.append(tx, {
      projectId: after.projectId,
      actorType: "USER",
      actorId,
      action: before ? "record.draft.update" : "record.draft.create",
      targetType: "CHANGE_RECORD",
      targetId: String(after.id),
      eventPayload: { before, after },
      requestId,
    });
  }
}
