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
import { ProjectArchiveRequestPort } from "./project-archive-request.port.js";
import { ProjectMembersQueryPort } from "./project-members-query.port.js";
import { ProjectRoleGateService } from "./project-role-gate.service.js";
import { ProjectStartNotifier } from "./project-start.notifier.js";
import {
  ProjectsWritePort,
  type ProjectChangeRecord,
} from "./projects-write.port.js";

const PROJECT_UPDATE_ACTIVITY = "PROJECT_UPDATED";
const PROJECT_ARCHIVED_ACTIVITY = "PROJECT_ARCHIVED";
const PROJECT_RESTORED_ACTIVITY = "PROJECT_RESTORED";
const PROJECT_STATUS_CHANGED_ACTIVITY = "PROJECT_STATUS_CHANGED";

/** F-06.3 状态接口可写入的目标态：归档必须走归档流程，不在其中。 */
export type ProjectLifecycleTarget = "NOT_STARTED" | "ACTIVE" | "MAINTENANCE";

const PROJECT_STATUS_LABELS: Readonly<Record<string, string>> = {
  NOT_STARTED: "未开始",
  ACTIVE: "进行中",
  MAINTENANCE: "维护中",
  ARCHIVED: "已归档",
};

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
    @Inject(ProjectMembersQueryPort)
    private readonly members: ProjectMembersQueryPort,
    @Inject(ProjectArchiveRequestPort)
    private readonly archiveRequests: ProjectArchiveRequestPort,
    @Inject(ProjectRoleGateService)
    private readonly roles: ProjectRoleGateService,
    @Inject(ProjectStartNotifier)
    private readonly startNotifier: ProjectStartNotifier,
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
   * 恢复专用授权：已归档项目允许继续；管理员身份与 CSRF
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

    return {
      project: this.toItem(updated),
      currentUserRole:
        (await this.members.findActiveRole(tx, {
          projectId: updated.projectId,
          userId: input.actorId,
        })) ?? null,
    };
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

  /**
   * F-06.3 项目状态变更：本项目任意活跃成员或系统管理员把项目在未开始、
   * 进行中、维护中之间手动切换。归档只能走归档流程，因此不是合法目标。
   *
   * 两条硬约束在服务端拦截，前端置灰只是提示：
   * - 未开始与维护中之间禁止直接互改，必须先经过进行中；
   * - 项目内出现过已完成任务后不可回退未开始（粘性标记永不回落）。
   *
   * 只有「未开始 → 进行中」通知全体活跃成员；维护中不通知，避免反复切换刷屏。
   * 状态、审计 `project.status.change`、活动与搜索投影在同一事务提交。
   */
  async changeProjectStatus(
    tx: TransactionContext,
    input: {
      readonly actorId: number;
      readonly projectId: number;
      readonly version: number;
      readonly target: ProjectLifecycleTarget;
      readonly requestId: string;
    },
  ): Promise<ProjectDetailResponse> {
    const role = await this.roles.manageRole(
      tx,
      input.actorId,
      input.projectId,
    );
    if (role === "NOT_MEMBER") throw missing();
    const current = await this.projects.findProjectForChange(
      tx,
      { projectId: input.projectId },
      true,
    );
    if (current === undefined) throw missing();
    if (current.status === "ARCHIVED") {
      throw new ProjectManagementError(
        409,
        "PROJECT_ARCHIVED",
        "项目已归档，项目只读",
      );
    }
    if (current.rowVersion !== input.version) throw versionConflict();
    if (current.status === input.target) {
      throw new ProjectManagementError(
        409,
        "PROJECT_STATE_CONFLICT",
        "项目已处于目标状态",
      );
    }
    if (input.target === "NOT_STARTED") {
      if (current.firstTaskCompletedAt !== null) {
        throw new ProjectManagementError(
          409,
          "PROJECT_STATUS_NOT_STARTED_LOCKED",
          "项目已有任务完成，不能回退为未开始",
        );
      }
      if (current.status === "MAINTENANCE") {
        throw new ProjectManagementError(
          409,
          "PROJECT_STATUS_LEVEL_SKIP",
          "维护中的项目不能直接切换为未开始，请先切换为进行中",
        );
      }
    }
    if (input.target === "MAINTENANCE" && current.status === "NOT_STARTED") {
      throw new ProjectManagementError(
        409,
        "PROJECT_STATUS_LEVEL_SKIP",
        "未开始的项目不能直接切换为维护中，请先切换为进行中",
      );
    }
    const updated = await this.projects.updateProjectStatus(tx, {
      projectId: input.projectId,
      expectedRowVersion: input.version,
      status: input.target,
    });
    if (updated === undefined) throw versionConflict();
    const occurredAt = new Date();
    const event = await this.audit.append(tx, {
      projectId: updated.projectId,
      actorType: "USER",
      actorId: input.actorId,
      action: "project.status.change",
      targetType: "PROJECT",
      targetId: String(updated.projectId),
      eventPayload: {
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
      activityType: PROJECT_STATUS_CHANGED_ACTIVITY,
      actorId: input.actorId,
      summary: `项目状态：${PROJECT_STATUS_LABELS[current.status] ?? current.status} → ${PROJECT_STATUS_LABELS[updated.status] ?? updated.status}（${updated.name}）`,
      metadata: {
        code: updated.code,
        beforeStatus: current.status,
        afterStatus: updated.status,
      },
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
    if (current.status === "NOT_STARTED" && updated.status === "ACTIVE") {
      await this.startNotifier.notify(tx, {
        projectId: updated.projectId,
        code: updated.code,
        name: updated.name,
        chainId: event.chainId,
        sequenceNo: event.sequenceNo,
        occurredAt,
      });
    }
    return {
      project: this.toItem(updated),
      currentUserRole:
        (await this.members.findActiveRole(tx, {
          projectId: updated.projectId,
          userId: input.actorId,
        })) ?? null,
    };
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
    // ADR-035：归档允许从任一未归档状态进入（未开始、进行中、维护中都可以直接归档）；
    // 恢复一律回到进行中，不保留归档前的状态。
    const stateConflict =
      input.target === "ARCHIVED"
        ? current.status === "ARCHIVED"
        : current.status !== "ARCHIVED";
    if (stateConflict) {
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
    // ADR-034：直接归档项目时结束仍待审的归档申请，避免悬挂的待办。
    const cancelledArchiveRequestIds =
      input.target === "ARCHIVED"
        ? await this.archiveRequests.cancelPendingRequests(tx, {
            projectId: updated.projectId,
            decidedBy: input.actorId,
          })
        : [];

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
        cancelledArchiveRequestIds,
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
    return {
      project: this.toItem(updated),
      currentUserRole:
        (await this.members.findActiveRole(tx, {
          projectId: updated.projectId,
          userId: input.actorId,
        })) ?? null,
    };
  }

  private toItem(record: ProjectChangeRecord): ProjectItem {
    return {
      id: record.projectId,
      code: record.code,
      name: record.name,
      description: record.description,
      status: record.status,
      hasCompletedTask: record.firstTaskCompletedAt !== null,
      rowVersion: record.rowVersion,
      createdBy: record.createdBy,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      memberCount: record.memberCount,
      stats: record.stats,
    };
  }
}
