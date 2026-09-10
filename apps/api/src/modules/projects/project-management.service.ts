import { Inject, Injectable } from "@nestjs/common";
import {
  projectReplayContextSchema,
  type ProjectArchivePreviewResponse,
  type ProjectDetailResponse,
  type ProjectEditRequest,
  type ProjectItem,
} from "@inpulse/api-contract";

import { AuditWritePort } from "../../audit/index.js";
import type { TransactionContext } from "../../database/transaction-context.js";
import { ActivityWritePort } from "../activity/index.js";
import { SearchProjectionWritePort } from "../search/index.js";
import {
  PROJECT_ACCESS_QUERY_PORT,
  type ProjectAccessQueryPort,
} from "./project-access.port.js";
import {
  ProjectsWritePort,
  type ProjectChangeRecord,
} from "./projects-write.port.js";

const PROJECT_UPDATE_ACTIVITY = "PROJECT_UPDATED";
const PROJECT_ARCHIVED_ACTIVITY = "PROJECT_ARCHIVED";
const PROJECT_RESTORED_ACTIVITY = "PROJECT_RESTORED";

export class ProjectManagementError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 422,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProjectManagementError";
  }
}

const missing = () =>
  new ProjectManagementError(
    404,
    "PROJECT_NOT_FOUND",
    "项目不存在或当前用户无权访问",
  );

const versionConflict = () =>
  new ProjectManagementError(
    409,
    "PROJECT_VERSION_CONFLICT",
    "项目版本已变化，请重新加载后编辑",
  );

/**
 * F-06.1 项目编辑：只接收显式 TransactionContext，名称/描述更新、
 * 审计、活动与搜索投影在同一事务内提交；编码创建后不可修改。
 */
@Injectable()
export class ProjectManagementService {
  constructor(
    @Inject(ProjectsWritePort) private readonly projects: ProjectsWritePort,
    @Inject(PROJECT_ACCESS_QUERY_PORT)
    private readonly access: ProjectAccessQueryPort,
    @Inject(AuditWritePort) private readonly audit: AuditWritePort,
    @Inject(ActivityWritePort) private readonly activity: ActivityWritePort,
    @Inject(SearchProjectionWritePort)
    private readonly search: SearchProjectionWritePort,
  ) {}

  /** 写前授权：实时成员关系与用户状态由 Port 读取，归档项目拒绝写入。 */
  async authorize(
    tx: TransactionContext,
    actorId: number,
    projectId: number,
  ): Promise<void> {
    const check = await this.access.checkProjectForWrite(tx, {
      actorUserId: actorId,
      projectId,
    });
    if (check.kind === "not-found") throw missing();
    if (check.kind === "parent-not-active")
      throw new ProjectManagementError(
        409,
        "PROJECT_ARCHIVED",
        "项目已归档，项目只读",
      );
  }

  /** 幂等重放前的当前权限复核；任一门禁失败都不得返回已存成功结果。 */
  async replay(
    tx: TransactionContext,
    actorId: number,
    context: unknown,
    options: { readonly allowArchived?: boolean } = {},
  ): Promise<void> {
    const resource = projectReplayContextSchema.safeParse(context);
    if (!resource.success) {
      throw new Error("invalid project replay context");
    }
    if (options.allowArchived === true) {
      await this.authorizeArchived(tx, actorId, resource.data.projectId);
      return;
    }
    await this.authorize(tx, actorId, resource.data.projectId);
  }

  /**
   * 恢复专用授权：已归档项目允许继续；管理员身份与重认证新鲜度
   * 由 HTTP 层 `AdminHighRiskAuthService` 校验。
   */
  async authorizeArchived(
    tx: TransactionContext,
    actorId: number,
    projectId: number,
  ): Promise<void> {
    const check = await this.access.checkProjectForWrite(tx, {
      actorUserId: actorId,
      projectId,
    });
    if (check.kind === "not-found") throw missing();
  }

  async updateProject(
    tx: TransactionContext,
    input: {
      readonly actorId: number;
      readonly projectId: number;
      readonly version: number;
      readonly edit: ProjectEditRequest;
      readonly requestId: string;
    },
  ): Promise<ProjectDetailResponse> {
    await this.authorize(tx, input.actorId, input.projectId);
    const current = await this.projects.findProjectForChange(
      tx,
      { projectId: input.projectId },
      true,
    );
    if (current === undefined) throw missing();
    if (current.rowVersion !== input.version) throw versionConflict();

    const updated = await this.projects.updateProjectDetails(tx, {
      projectId: input.projectId,
      expectedRowVersion: input.version,
      name: input.edit.name,
      description: input.edit.description,
    });
    if (updated === undefined) throw versionConflict();

    const occurredAt = new Date();
    const event = await this.audit.append(tx, {
      projectId: updated.projectId,
      actorType: "USER",
      actorId: input.actorId,
      action: "project.update",
      targetType: "PROJECT",
      targetId: String(updated.projectId),
      eventPayload: {
        before: {
          name: current.name,
          description: current.description,
          rowVersion: current.rowVersion,
        },
        after: {
          name: updated.name,
          description: updated.description,
          rowVersion: updated.rowVersion,
        },
      },
      requestId: input.requestId,
      occurredAt,
    });
    await this.activity.append(tx, {
      projectId: updated.projectId,
      sourceChainId: event.chainId,
      sourceSequence: event.sequenceNo,
      sourceEntityType: "PROJECT",
      sourceEntityId: updated.projectId,
      activityType: PROJECT_UPDATE_ACTIVITY,
      actorId: input.actorId,
      summary: `更新了项目 ${updated.name}`,
      metadata: { code: updated.code },
      visibilityScope: "MEMBER",
      sourceStatus: updated.status,
      sourceRowVersion: updated.rowVersion,
      occurredAt,
    });
    await this.search.upsert(tx, {
      projectId: updated.projectId,
      entityType: "PROJECT",
      entityId: updated.projectId,
      title: updated.name,
      summary: updated.description.slice(0, 5000),
      rawText: `${updated.code} ${updated.name} ${updated.description}`,
      visibilityScope: "MEMBER",
      sourceStatus: updated.status,
      sourceRowVersion: updated.rowVersion,
    });

    return { project: this.toItem(updated) };
  }

  async archiveProject(
    tx: TransactionContext,
    input: {
      readonly actorId: number;
      readonly projectId: number;
      readonly version: number;
      readonly reason: string;
      readonly requestId: string;
    },
  ): Promise<ProjectDetailResponse> {
    return this.changeStatus(tx, { ...input, target: "ARCHIVED" });
  }

  async restoreProject(
    tx: TransactionContext,
    input: {
      readonly actorId: number;
      readonly projectId: number;
      readonly version: number;
      readonly reason: string;
      readonly requestId: string;
    },
  ): Promise<ProjectDetailResponse> {
    return this.changeStatus(tx, { ...input, target: "ACTIVE" });
  }

  /** 归档前未完成任务提醒；只读，归档项目也可查看。 */
  async archivePreview(
    tx: TransactionContext,
    actorId: number,
    projectId: number,
  ): Promise<ProjectArchivePreviewResponse> {
    await this.authorizeArchived(tx, actorId, projectId);
    return {
      projectId,
      unfinishedTaskCount: await this.projects.countUnfinishedTasks(tx, {
        projectId,
      }),
    };
  }

  private async changeStatus(
    tx: TransactionContext,
    input: {
      readonly actorId: number;
      readonly projectId: number;
      readonly version: number;
      readonly reason: string;
      readonly requestId: string;
      readonly target: "ACTIVE" | "ARCHIVED";
    },
  ): Promise<ProjectDetailResponse> {
    if (input.target === "ARCHIVED") {
      await this.authorize(tx, input.actorId, input.projectId);
    } else {
      await this.authorizeArchived(tx, input.actorId, input.projectId);
    }
    const current = await this.projects.findProjectForChange(
      tx,
      { projectId: input.projectId },
      true,
    );
    if (current === undefined) throw missing();
    if (current.rowVersion !== input.version) throw versionConflict();
    const expected = input.target === "ARCHIVED" ? "ACTIVE" : "ARCHIVED";
    if (current.status !== expected) {
      throw new ProjectManagementError(
        409,
        "PROJECT_STATE_CONFLICT",
        input.target === "ARCHIVED"
          ? "项目已归档，不能重复归档"
          : "项目未归档，不能恢复",
      );
    }
    const updated = await this.projects.updateProjectStatus(tx, {
      projectId: input.projectId,
      expectedRowVersion: input.version,
      status: input.target,
    });
    if (updated === undefined) throw versionConflict();

    const action = input.target === "ARCHIVED" ? "archive" : "restore";
    const occurredAt = new Date();
    const event = await this.audit.append(tx, {
      projectId: updated.projectId,
      actorType: "USER",
      actorId: input.actorId,
      action: `project.${action}`,
      targetType: "PROJECT",
      targetId: String(updated.projectId),
      eventPayload: {
        reason: input.reason,
        before: { status: current.status, rowVersion: current.rowVersion },
        after: { status: updated.status, rowVersion: updated.rowVersion },
      },
      requestId: input.requestId,
      occurredAt,
    });
    await this.activity.append(tx, {
      projectId: updated.projectId,
      sourceChainId: event.chainId,
      sourceSequence: event.sequenceNo,
      sourceEntityType: "PROJECT",
      sourceEntityId: updated.projectId,
      activityType:
        input.target === "ARCHIVED"
          ? PROJECT_ARCHIVED_ACTIVITY
          : PROJECT_RESTORED_ACTIVITY,
      actorId: input.actorId,
      summary:
        input.target === "ARCHIVED"
          ? `归档了项目 ${updated.name}`
          : `恢复了项目 ${updated.name}`,
      metadata: { code: updated.code, reason: input.reason },
      visibilityScope: "MEMBER",
      sourceStatus: updated.status,
      sourceRowVersion: updated.rowVersion,
      occurredAt,
    });
    await this.search.upsert(tx, {
      projectId: updated.projectId,
      entityType: "PROJECT",
      entityId: updated.projectId,
      title: updated.name,
      summary: updated.description.slice(0, 5000),
      rawText: `${updated.code} ${updated.name} ${updated.description}`,
      visibilityScope: "MEMBER",
      sourceStatus: updated.status,
      sourceRowVersion: updated.rowVersion,
    });
    return { project: this.toItem(updated) };
  }

  private toItem(record: ProjectChangeRecord): ProjectItem {
    return {
      id: record.projectId,
      code: record.code,
      name: record.name,
      description: record.description,
      status: record.status,
      rowVersion: record.rowVersion,
      createdBy: record.createdBy,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      memberCount: record.memberCount,
    };
  }
}
