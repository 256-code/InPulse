import {
  RecordPublicationRepository,
  type PublicationIdentity,
} from "./record-publication.repository.js";
import { Inject, Injectable } from "@nestjs/common";
import type { TransactionContext } from "../../database/transaction-context.js";
import {
  PROJECT_ACCESS_QUERY_PORT,
  type ProjectAccessQueryPort,
} from "../projects/index.js";
import { ModuleQueryPort } from "../modules/index.js";
import { FeatureQueryPort } from "../features/index.js";
import { TaskQueryPort, type TaskDraftSource } from "../tasks/index.js";
import { RecordDraftError } from "./record-drafts.service.js";
@Injectable()
export class RecordPublicationAccess {
  constructor(
    @Inject(PROJECT_ACCESS_QUERY_PORT)
    private readonly access: ProjectAccessQueryPort,
    @Inject(ModuleQueryPort) private readonly modules: ModuleQueryPort,
    @Inject(FeatureQueryPort) private readonly features: FeatureQueryPort,
    @Inject(TaskQueryPort) private readonly tasks: TaskQueryPort,
    @Inject(RecordPublicationRepository)
    private readonly repository: RecordPublicationRepository,
  ) {}
  private missing() {
    return new RecordDraftError(
      404,
      "CHANGE_RECORD_NOT_FOUND",
      "记录不存在或无法访问",
    );
  }
  async authorizeProject(
    tx: TransactionContext,
    actorId: number,
    projectId: number,
  ) {
    const project = await this.access.checkProjectForWrite(tx, {
      actorUserId: actorId,
      projectId,
    });
    if (project.kind === "not-found") throw this.missing();
    if (project.kind === "parent-not-active")
      throw new RecordDraftError(
        409,
        "RECORD_PARENT_ARCHIVED",
        "项目已归档，记录只读",
      );
  }
  async prepare(
    tx: TransactionContext,
    actorId: number,
    projectId: number,
    recordId: number,
    publish: boolean,
  ) {
    const project = await this.access.checkProjectForWrite(tx, {
      actorUserId: actorId,
      projectId,
    });
    if (project.kind === "not-found") throw this.missing();
    for (let attempt = 0; attempt < 3; attempt++) {
      await tx.sql`SAVEPOINT record_publication_locks`;
      const previous = await this.repository.identity(tx, projectId, recordId);
      if (!previous || previous.status === "VOID") throw this.missing();
      const module = await this.modules.checkModuleForWrite(tx, previous);
      if (module.kind === "not-found") throw this.missing();
      if (
        project.kind === "parent-not-active" ||
        module.kind === "parent-not-active"
      )
        throw new RecordDraftError(
          409,
          "RECORD_PARENT_ARCHIVED",
          "项目或模块已归档，记录只读",
        );
      let source: TaskDraftSource | undefined;
      if (publish && previous.taskId !== null) {
        source = await this.tasks.find(tx, projectId, previous.taskId);
        if (
          !source ||
          source.moduleId !== previous.moduleId ||
          source.featureId !== previous.featureId
        )
          throw this.missing();
      }
      const ids = [
        ...new Set([
          ...(previous.featureId === null
            ? previous.impactFeatureIds
            : [previous.featureId]),
          ...(source?.impactFeatureIds ?? []),
        ]),
      ].sort((a, b) => a - b);
      for (const featureId of ids) {
        const feature = await this.features.checkFeatureForWrite(tx, {
          projectId,
          moduleId: previous.moduleId,
          featureId,
        });
        if (feature.kind === "not-found") throw this.missing();
        if (
          feature.kind === "parent-not-active" &&
          featureId === previous.featureId
        )
          throw new RecordDraftError(
            409,
            "RECORD_PARENT_ARCHIVED",
            "所属功能已归档，记录只读",
          );
      }
      if (source) {
        const locked = await this.tasks.lock(tx, projectId, source.taskId);
        if (JSON.stringify(locked) !== JSON.stringify(source)) {
          await tx.sql`ROLLBACK TO SAVEPOINT record_publication_locks`;
          await tx.sql`RELEASE SAVEPOINT record_publication_locks`;
          continue;
        }
        source = locked;
      }
      const current = await this.repository.identity(
        tx,
        projectId,
        recordId,
        true,
      );
      if (!current || current.status === "VOID") throw this.missing();
      if (
        current.moduleId !== previous.moduleId ||
        current.featureId !== previous.featureId ||
        current.taskId !== previous.taskId ||
        JSON.stringify(current.impactFeatureIds) !==
          JSON.stringify(previous.impactFeatureIds)
      )
        throw new RecordDraftError(
          409,
          "RECORD_SCOPE_CONFLICT",
          "记录归属或来源已变化，请刷新后重试",
        );
      if (publish && current.status !== "DRAFT")
        throw new RecordDraftError(
          409,
          "RECORD_ALREADY_PUBLISHED",
          "记录已发布，请查看正式记录",
        );
      if (publish && source?.workStatus !== "DONE" && source !== undefined)
        throw new RecordDraftError(
          409,
          "RECORD_SOURCE_NOT_DONE",
          "来源任务尚未完成，请使用发布并完成流程",
        );
      if (!publish && current.status !== "PUBLISHED")
        throw new RecordDraftError(409, "RECORD_NOT_PUBLISHED", "记录尚未发布");
      await tx.sql`RELEASE SAVEPOINT record_publication_locks`;
      return { record: current, source };
    }
    throw new RecordDraftError(
      409,
      "RECORD_SOURCE_CONFLICT",
      "来源任务变化频繁，请刷新后重试",
    );
  }
  async taskAssignee(tx: TransactionContext, record: PublicationIdentity) {
    if (record.taskId === null) return undefined;
    const source = await this.tasks.find(tx, record.projectId, record.taskId);
    if (
      !source ||
      source.moduleId !== record.moduleId ||
      source.featureId !== record.featureId
    )
      throw this.missing();
    return source.assigneeId;
  }
}
