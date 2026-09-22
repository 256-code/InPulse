import { Inject, Injectable } from "@nestjs/common";
import type {
  ProjectArchiveRequestItem,
  ProjectDetailResponse,
} from "@inpulse/api-contract";

import { AuditWritePort } from "../../audit/index.js";
import type { TransactionContext } from "../../database/transaction-context.js";
import { ActivityWritePort } from "../activity/index.js";
import { NotificationWritePort } from "../notifications/index.js";
import { SearchProjectionWritePort } from "../search/index.js";
import {
  PROJECT_ACCESS_QUERY_PORT,
  type ProjectAccessQueryPort,
} from "./project-access.port.js";
import {
  ProjectArchiveRequestPort,
  type ProjectArchiveRequestRecord,
} from "./project-archive-request.port.js";
import { ProjectMembersQueryPort } from "./project-members-query.port.js";
import { ProjectRoleGateService } from "./project-role-gate.service.js";
import {
  ProjectsWritePort,
  type ProjectChangeRecord,
} from "./projects-write.port.js";

const PROJECT_ARCHIVE_REQUESTED_ACTIVITY = "PROJECT_ARCHIVE_REQUESTED";
const PROJECT_ARCHIVED_ACTIVITY = "PROJECT_ARCHIVED";
const PROJECT_ARCHIVE_REJECTED_ACTIVITY = "PROJECT_ARCHIVE_REJECTED";
const PROJECT_ARCHIVE_REQUEST_NOTIFICATION = "PROJECT_ARCHIVE_REQUESTED";
const PROJECT_ARCHIVE_APPROVED_NOTIFICATION = "PROJECT_ARCHIVE_APPROVED";
const PROJECT_ARCHIVE_REJECTED_NOTIFICATION = "PROJECT_ARCHIVE_REJECTED";
/** 申请与审核共用列表页入口，审核动作由系统管理员在项目列表完成。 */
const PROJECT_ARCHIVE_TARGET_PATH = "/projects";

export class ProjectArchiveRequestError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 422,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProjectArchiveRequestError";
  }
}

const missing = () =>
  new ProjectArchiveRequestError(
    404,
    "PROJECT_NOT_FOUND",
    "项目不存在或当前用户无权访问",
  );

const requestMissing = () =>
  new ProjectArchiveRequestError(
    404,
    "PROJECT_ARCHIVE_REQUEST_NOT_FOUND",
    "归档申请不存在或不属于该项目",
  );

const versionConflict = () =>
  new ProjectArchiveRequestError(
    409,
    "PROJECT_VERSION_CONFLICT",
    "项目版本已变化，请重新加载后审核",
  );

/**
 * F-06.2 项目归档申请（ADR-034）：项目组长、项目管理员或系统管理员发起申请，
 * 只有系统管理员能批准归档。申请与前级校验、审计、活动、通知在同一事务提交。
 */
@Injectable()
export class ProjectArchiveRequestService {
  constructor(
    @Inject(ProjectsWritePort) private readonly projects: ProjectsWritePort,
    @Inject(ProjectArchiveRequestPort)
    private readonly requests: ProjectArchiveRequestPort,
    @Inject(PROJECT_ACCESS_QUERY_PORT)
    private readonly access: ProjectAccessQueryPort,
    @Inject(ProjectRoleGateService)
    private readonly roles: ProjectRoleGateService,
    @Inject(ProjectMembersQueryPort)
    private readonly members: ProjectMembersQueryPort,
    @Inject(AuditWritePort) private readonly audit: AuditWritePort,
    @Inject(ActivityWritePort) private readonly activity: ActivityWritePort,
    @Inject(SearchProjectionWritePort)
    private readonly search: SearchProjectionWritePort,
    @Inject(NotificationWritePort)
    private readonly notifications: NotificationWritePort,
  ) {}

  /** 幂等重放前的当前权限复核；任一门禁失败都不得返回已存成功结果。 */
  async replay(
    tx: TransactionContext,
    actorId: number,
    context: unknown,
    options: { readonly systemAdminOnly?: boolean } = {},
  ): Promise<void> {
    const parsed = context as { projectId?: unknown; requestId?: unknown };
    const projectId = Number(parsed?.projectId);
    if (!Number.isSafeInteger(projectId) || projectId <= 0) {
      throw new Error("invalid project archive request replay context");
    }
    const check = await this.access.checkProjectForWrite(tx, {
      actorUserId: actorId,
      projectId,
    });
    if (check.kind === "not-found") throw missing();
    if (options.systemAdminOnly === true) {
      if (!check.resource.isSystemAdmin)
        throw new ProjectArchiveRequestError(
          403,
          "ADMIN_REQUIRED",
          "只有系统管理员可以审核项目归档申请",
        );
      return;
    }
    const role = await this.roles.manageRole(tx, actorId, projectId);
    if (role === "NOT_MEMBER") throw missing();
  }

  /** 提交项目归档申请：项目必须 ACTIVE 且全部任务已归档。 */
  async submit(
    tx: TransactionContext,
    input: {
      readonly actorId: number;
      readonly projectId: number;
      readonly reason: string;
      readonly traceId: string;
    },
  ): Promise<ProjectArchiveRequestItem> {
    const check = await this.access.checkProjectForWrite(tx, {
      actorUserId: input.actorId,
      projectId: input.projectId,
    });
    if (check.kind === "not-found") throw missing();
    const role = await this.roles.manageRole(
      tx,
      input.actorId,
      input.projectId,
    );
    if (role === "NOT_MEMBER") throw missing();
    if (check.kind === "parent-not-active")
      throw new ProjectArchiveRequestError(
        409,
        "PROJECT_ARCHIVED",
        "项目已归档，不能再次申请归档",
      );
    const project = await this.projects.findProjectForChange(tx, {
      projectId: input.projectId,
    });
    if (project === undefined) throw missing();

    const unarchivedTaskCount = await this.projects.countUnarchivedTasks(tx, {
      projectId: input.projectId,
    });
    if (unarchivedTaskCount > 0)
      throw new ProjectArchiveRequestError(
        409,
        "PROJECT_ARCHIVE_TASKS_OPEN",
        `项目下仍有 ${unarchivedTaskCount} 个未完成、也未归档的任务，请先完成或归档全部任务再申请项目归档`,
      );

    const created = await this.requests.insertRequest(tx, {
      projectId: input.projectId,
      requestedBy: input.actorId,
      reason: input.reason,
    });
    if (created === undefined)
      throw new ProjectArchiveRequestError(
        409,
        "PROJECT_ARCHIVE_REQUEST_EXISTS",
        "该项目已有待审核的归档申请，请等待系统管理员审核",
      );

    const occurredAt = new Date();
    const event = await this.audit.append(tx, {
      projectId: input.projectId,
      actorType: "USER",
      actorId: input.actorId,
      action: "project.archive.request",
      targetType: "PROJECT",
      targetId: String(input.projectId),
      eventPayload: {
        archiveRequestId: created.requestId,
        reason: created.reason,
      },
      requestId: input.traceId,
      occurredAt,
    });
    await this.activity.append(tx, {
      projectId: input.projectId,
      sourceChainId: event.chainId,
      sourceSequence: event.sequenceNo,
      sourceEntityType: "PROJECT",
      sourceEntityId: input.projectId,
      activityType: PROJECT_ARCHIVE_REQUESTED_ACTIVITY,
      actorId: input.actorId,
      summary: `发起了项目归档申请：${project.name}`,
      metadata: { code: project.code, archiveRequestId: created.requestId },
      visibilityScope: "MEMBER",
      sourceStatus: project.status,
      sourceRowVersion: project.rowVersion,
      occurredAt,
    });
    for (const recipientId of await this.requests.listActiveAdminIds(tx)) {
      await this.notifications.write(tx, {
        recipientId,
        projectId: input.projectId,
        sourceChainId: event.chainId,
        sourceSequence: event.sequenceNo,
        notificationType: PROJECT_ARCHIVE_REQUEST_NOTIFICATION,
        title: `项目归档申请：${project.name}`.slice(0, 500),
        body: created.reason,
        targetPath: PROJECT_ARCHIVE_TARGET_PATH,
        createdAt: occurredAt,
      });
    }
    return this.toItem(created);
  }

  /**
   * 批准并归档项目：申请必须仍为待审、项目必须 ACTIVE 且版本匹配，
   * 归档、申请状态、审计、活动、搜索投影与通知申请人在同一事务提交。
   */
  async approve(
    tx: TransactionContext,
    input: {
      readonly actorId: number;
      readonly projectId: number;
      readonly archiveRequestId: number;
      readonly version: number;
      readonly traceId: string;
    },
  ): Promise<ProjectDetailResponse> {
    const current = await this.projects.findProjectForChange(
      tx,
      { projectId: input.projectId },
      true,
    );
    if (current === undefined) throw missing();
    if (current.rowVersion !== input.version) throw versionConflict();
    // ADR-035：项目四态后只有已归档项目不能再次归档；未开始与维护中也允许批准归档。
    if (current.status === "ARCHIVED")
      throw new ProjectArchiveRequestError(
        409,
        "PROJECT_STATE_CONFLICT",
        "项目已归档，不能重复归档",
      );
    const request = await this.requests.findRequest(
      tx,
      { projectId: input.projectId, requestId: input.archiveRequestId },
      true,
    );
    if (request === undefined) throw requestMissing();
    if (request.status !== "PENDING")
      throw new ProjectArchiveRequestError(
        409,
        "PROJECT_ARCHIVE_REQUEST_DECIDED",
        "该归档申请已处理，不能重复审核",
      );
    const unarchivedTaskCount = await this.projects.countUnarchivedTasks(tx, {
      projectId: input.projectId,
    });
    if (unarchivedTaskCount > 0)
      throw new ProjectArchiveRequestError(
        409,
        "PROJECT_ARCHIVE_TASKS_OPEN",
        `项目下仍有 ${unarchivedTaskCount} 个未完成、也未归档的任务，无法归档项目`,
      );

    const updated = await this.projects.updateProjectStatus(tx, {
      projectId: input.projectId,
      expectedRowVersion: input.version,
      status: "ARCHIVED",
    });
    if (updated === undefined) throw versionConflict();
    const decided = await this.requests.decideRequest(tx, {
      projectId: input.projectId,
      requestId: request.requestId,
      status: "APPROVED",
      decidedBy: input.actorId,
      decisionNote: null,
      expectedRowVersion: request.rowVersion,
    });
    if (decided === undefined)
      throw new ProjectArchiveRequestError(
        409,
        "PROJECT_ARCHIVE_REQUEST_CONFLICT",
        "归档申请状态已变化，请重新加载",
      );

    const occurredAt = new Date();
    const event = await this.audit.append(tx, {
      projectId: updated.projectId,
      actorType: "USER",
      actorId: input.actorId,
      action: "project.archive",
      targetType: "PROJECT",
      targetId: String(updated.projectId),
      eventPayload: {
        reason: request.reason,
        archiveRequestId: request.requestId,
        viaArchiveRequest: true,
        before: { status: current.status, rowVersion: current.rowVersion },
        after: { status: updated.status, rowVersion: updated.rowVersion },
      },
      requestId: input.traceId,
      occurredAt,
    });
    await this.activity.append(tx, {
      projectId: updated.projectId,
      sourceChainId: event.chainId,
      sourceSequence: event.sequenceNo,
      sourceEntityType: "PROJECT",
      sourceEntityId: updated.projectId,
      activityType: PROJECT_ARCHIVED_ACTIVITY,
      actorId: input.actorId,
      summary: `批准归档申请并归档了项目 ${updated.name}`,
      metadata: {
        code: updated.code,
        reason: request.reason,
        archiveRequestId: request.requestId,
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
    await this.notifications.write(tx, {
      recipientId: request.requestedBy,
      projectId: updated.projectId,
      sourceChainId: event.chainId,
      sourceSequence: event.sequenceNo,
      notificationType: PROJECT_ARCHIVE_APPROVED_NOTIFICATION,
      title: `项目归档申请已通过：${updated.name}`.slice(0, 500),
      body: request.reason,
      targetPath: PROJECT_ARCHIVE_TARGET_PATH,
      createdAt: occurredAt,
    });
    return {
      project: this.toProjectItem(updated),
      currentUserRole:
        (await this.members.findActiveRole(tx, {
          projectId: updated.projectId,
          userId: input.actorId,
        })) ?? null,
    };
  }

  /** 驳回归档申请：只结束申请，不改变项目状态。 */
  async reject(
    tx: TransactionContext,
    input: {
      readonly actorId: number;
      readonly projectId: number;
      readonly archiveRequestId: number;
      readonly note: string;
      readonly traceId: string;
    },
  ): Promise<ProjectArchiveRequestItem> {
    const project = await this.projects.findProject(tx, {
      projectId: input.projectId,
    });
    if (project === undefined) throw missing();
    const request = await this.requests.findRequest(
      tx,
      { projectId: input.projectId, requestId: input.archiveRequestId },
      true,
    );
    if (request === undefined) throw requestMissing();
    if (request.status !== "PENDING")
      throw new ProjectArchiveRequestError(
        409,
        "PROJECT_ARCHIVE_REQUEST_DECIDED",
        "该归档申请已处理，不能重复审核",
      );
    const decided = await this.requests.decideRequest(tx, {
      projectId: input.projectId,
      requestId: request.requestId,
      status: "REJECTED",
      decidedBy: input.actorId,
      decisionNote: input.note.length === 0 ? null : input.note,
      expectedRowVersion: request.rowVersion,
    });
    if (decided === undefined)
      throw new ProjectArchiveRequestError(
        409,
        "PROJECT_ARCHIVE_REQUEST_CONFLICT",
        "归档申请状态已变化，请重新加载",
      );
    const occurredAt = new Date();
    const event = await this.audit.append(tx, {
      projectId: input.projectId,
      actorType: "USER",
      actorId: input.actorId,
      action: "project.archive.reject",
      targetType: "PROJECT",
      targetId: String(input.projectId),
      eventPayload: {
        archiveRequestId: decided.requestId,
        reason: decided.reason,
        note: decided.decisionNote,
      },
      requestId: input.traceId,
      occurredAt,
    });
    await this.activity.append(tx, {
      projectId: input.projectId,
      sourceChainId: event.chainId,
      sourceSequence: event.sequenceNo,
      sourceEntityType: "PROJECT",
      sourceEntityId: input.projectId,
      activityType: PROJECT_ARCHIVE_REJECTED_ACTIVITY,
      actorId: input.actorId,
      summary: `驳回了项目归档申请：${project.name}`,
      metadata: { archiveRequestId: decided.requestId },
      visibilityScope: "MEMBER",
      sourceStatus: project.status,
      sourceRowVersion: project.rowVersion,
      occurredAt,
    });
    await this.notifications.write(tx, {
      recipientId: decided.requestedBy,
      projectId: input.projectId,
      sourceChainId: event.chainId,
      sourceSequence: event.sequenceNo,
      notificationType: PROJECT_ARCHIVE_REJECTED_NOTIFICATION,
      title: `项目归档申请被驳回：${project.name}`.slice(0, 500),
      body: decided.decisionNote ?? "系统管理员驳回了本次归档申请",
      targetPath: PROJECT_ARCHIVE_TARGET_PATH,
      createdAt: occurredAt,
    });
    return this.toItem(decided);
  }

  private toItem(
    record: ProjectArchiveRequestRecord,
  ): ProjectArchiveRequestItem {
    return {
      id: record.requestId,
      projectId: record.projectId,
      requestedBy: record.requestedBy,
      requestedByName: record.requestedByName,
      reason: record.reason,
      status: record.status,
      requestedAt: record.requestedAt,
      decidedBy: record.decidedBy,
      decidedByName: record.decidedByName,
      decidedAt: record.decidedAt,
      decisionNote: record.decisionNote,
      rowVersion: record.rowVersion,
    };
  }

  private toProjectItem(record: ProjectChangeRecord) {
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
