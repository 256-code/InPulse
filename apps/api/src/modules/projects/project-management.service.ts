import { Inject, Injectable } from "@nestjs/common";
import {
  projectReplayContextSchema,
  type ProjectDetailResponse,
  type ProjectEditRequest,
  type ProjectItem,
  type ProjectPurgeResponse,
} from "@inpulse/api-contract";

import { AuditWritePort } from "../../audit/index.js";
import type { TransactionContext } from "../../database/transaction-context.js";
import { ActivityWritePort } from "../activity/index.js";
import { SearchProjectionWritePort } from "../search/index.js";
import {
  PROJECT_ACCESS_QUERY_PORT,
  type ProjectAccessQueryPort,
} from "./project-access.port.js";
import { ProjectMembersQueryPort } from "./project-members-query.port.js";
import { ProjectRoleGateService } from "./project-role-gate.service.js";
import { ProjectStartNotifier } from "./project-start.notifier.js";
import {
  ProjectsWritePort,
  type ProjectChangeRecord,
} from "./projects-write.port.js";

const PROJECT_UPDATE_ACTIVITY = "PROJECT_UPDATED";
const PROJECT_STATUS_CHANGED_ACTIVITY = "PROJECT_STATUS_CHANGED";
const PROJECT_DELETED_ACTIVITY = "PROJECT_DELETED";
const PROJECT_RESTORED_ACTIVITY = "PROJECT_RESTORED";

/** F-06.3 状态接口可写入的目标态：项目三态，不存在归档。 */
export type ProjectLifecycleTarget = "NOT_STARTED" | "ACTIVE" | "MAINTENANCE";

const PROJECT_STATUS_LABELS: Readonly<Record<string, string>> = {
  NOT_STARTED: "未开始",
  ACTIVE: "进行中",
  MAINTENANCE: "维护中",
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

/** ADR-049：删除只对系统管理员与项目组长开放，普通成员明确 403。 */
const deleteForbidden = () =>
  new ProjectManagementError(
    403,
    "PROJECT_DELETE_FORBIDDEN",
    "只有项目组长或系统管理员可以删除项目",
  );

/** ADR-051：还原沿用删除的同一口径。 */
const restoreForbidden = () =>
  new ProjectManagementError(
    403,
    "PROJECT_RESTORE_FORBIDDEN",
    "只有项目组长或系统管理员可以还原项目",
  );

/** ADR-051：彻底删除不可撤销，只有系统管理员可以执行。 */
const purgeForbidden = () =>
  new ProjectManagementError(
    403,
    "PROJECT_PURGE_FORBIDDEN",
    "只有系统管理员可以彻底删除项目",
  );

/** ADR-051：还原与彻底删除都只接受处于已删除状态的项目。 */
const projectNotDeleted = (action: "restore" | "purge") =>
  new ProjectManagementError(
    409,
    "PROJECT_NOT_DELETED",
    action === "restore"
      ? "项目未被删除，无需还原"
      : "项目未被删除，不能彻底删除",
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
    @Inject(ProjectRoleGateService)
    private readonly roles: ProjectRoleGateService,
    @Inject(ProjectStartNotifier)
    private readonly startNotifier: ProjectStartNotifier,
  ) {}

  /** 写前授权：实时成员关系与用户状态由 Port 读取；项目三态下没有只读态。 */
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
  }

  /** 幂等重放前的当前权限复核；任一门禁失败都不得返回已存成功结果。 */
  async replay(
    tx: TransactionContext,
    actorId: number,
    context: unknown,
  ): Promise<void> {
    const resource = projectReplayContextSchema.safeParse(context);
    if (!resource.success) {
      throw new Error("invalid project replay context");
    }
    await this.authorize(tx, actorId, resource.data.projectId);
  }

  /**
   * ADR-049 删除重放授权（契约 `currentReadAuthorizer:
   * "projectDeleteReplayAuthorizer"`）：项目已经删除，`authorize` 必然 404，
   * 所以改读保留的成员关系复核当前角色；组长的身份被转移或被移除后重放
   * 拒绝，不得泄露已存的 204。当前认证由 HTTP 层在调用前完成。
   */
  async replayDelete(
    tx: TransactionContext,
    actorId: number,
    context: unknown,
  ): Promise<void> {
    const resource = projectReplayContextSchema.safeParse(context);
    if (!resource.success) {
      throw new Error("invalid project replay context");
    }
    const role = await this.roles.projectDeleterReplayRole(
      tx,
      actorId,
      resource.data.projectId,
    );
    if (role === "NOT_MEMBER") throw missing();
    if (role === "MEMBER") throw deleteForbidden();
  }

  /**
   * ADR-051 彻底删除重放授权（契约 `currentReadAuthorizer:
   * "projectPurgeReplayAuthorizer"`）：项目行与它自己的审计链已经被物理删除，
   * 任何项目内资源复核都不再成立，因此只复核当前 Session 是否仍是有效的
   * 系统管理员（与首次执行的同一门禁）。当前认证由 HTTP 层在调用前完成。
   */
  async replayPurge(
    _tx: TransactionContext,
    actorId: number,
    context: unknown,
  ): Promise<void> {
    const resource = projectReplayContextSchema.safeParse(context);
    if (!resource.success) {
      throw new Error("invalid project replay context");
    }
    const role = await this.roles.projectPurgeReplayRole(actorId);
    if (role === "FORBIDDEN") throw purgeForbidden();
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

  /**
   * F-06.3 项目状态变更：本项目任意活跃成员或系统管理员把项目在未开始、
   * 进行中、维护中之间手动切换；项目三态下不存在归档，也没有归档流程。
   *
   * 三条硬约束在服务端拦截，前端置灰只是提示：
   * - 未开始与维护中之间禁止直接互改，必须先经过进行中；
   * - 项目内出现过已完成任务后不可回退未开始（粘性标记永不回落）；
   * - 进入维护中要求项目下任务全部收尾（未完成且未取消的任务数为 0）。
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
    if (input.target === "MAINTENANCE") {
      const openTaskCount = await this.projects.countOpenTasks(tx, {
        projectId: input.projectId,
      });
      if (openTaskCount > 0) {
        throw new ProjectManagementError(
          409,
          "PROJECT_MAINTENANCE_TASKS_OPEN",
          `项目下仍有 ${openTaskCount} 个未完成、也未取消的任务，请先完成或取消全部任务再切换为维护中`,
        );
      }
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

  /**
   * ADR-049 项目删除（软删除）：只有本项目组长与系统管理员可以删除，
   * 普通成员 403 `PROJECT_DELETE_FORBIDDEN`，非成员由写前授权统一 404。
   *
   * 删除只写 `deleted_at` / `deleted_by`：项目退出列表、详情、搜索范围、
   * 项目动态与全部项目级读写（写前校验统一 404），但模块、功能、任务、
   * 迭代记录、外部链接、成员关系与审计链全部保留，项目编码继续被占用。
   * 因此删除之后仍可在数据库层按 SQL 恢复，且不需要迁移或删除任何历史。
   *
   * 审计 `project.delete` 与项目动态在同一事务提交；**不写站内通知**：
   * 通知的深链指向已不可见的项目，发出去就是死链，成员需要的是「项目不见了」
   * 这一事实本身，而不是一条点不开的提醒。
   */
  async deleteProject(
    tx: TransactionContext,
    input: {
      readonly actorId: number;
      readonly projectId: number;
      readonly version: number;
      readonly requestId: string;
    },
  ): Promise<void> {
    const role = await this.roles.projectDeleterRole(
      tx,
      input.actorId,
      input.projectId,
    );
    if (role === "NOT_MEMBER") throw missing();
    if (role === "MEMBER") throw deleteForbidden();
    const current = await this.projects.findProjectForChange(
      tx,
      { projectId: input.projectId },
      true,
    );
    if (current === undefined) throw missing();
    if (current.rowVersion !== input.version) throw versionConflict();

    const occurredAt = new Date();
    const deleted = await this.projects.softDeleteProject(tx, {
      projectId: input.projectId,
      expectedRowVersion: input.version,
      actorId: input.actorId,
      deletedAt: occurredAt,
    });
    if (!deleted) throw versionConflict();

    const event = await this.audit.append(tx, {
      projectId: input.projectId,
      actorType: "USER",
      actorId: input.actorId,
      action: "project.delete",
      targetType: "PROJECT",
      targetId: String(input.projectId),
      eventPayload: {
        before: {
          code: current.code,
          name: current.name,
          status: current.status,
          rowVersion: current.rowVersion,
        },
        after: {
          deletedAt: occurredAt.toISOString(),
          deletedBy: input.actorId,
          rowVersion: current.rowVersion + 1,
        },
        retained: {
          memberCount: current.memberCount,
          stats: current.stats,
        },
      },
      requestId: input.requestId,
      occurredAt,
    });
    await this.activity.append(tx, {
      projectId: input.projectId,
      sourceChainId: event.chainId,
      sourceSequence: event.sequenceNo,
      sourceEntityType: "PROJECT",
      sourceEntityId: input.projectId,
      activityType: PROJECT_DELETED_ACTIVITY,
      actorId: input.actorId,
      summary: `删除了项目 ${current.name}`,
      metadata: { code: current.code, role },
      visibilityScope: "MEMBER",
      sourceStatus: current.status,
      sourceRowVersion: current.rowVersion + 1,
      occurredAt,
    });
  }

  /**
   * ADR-051 项目还原：撤销 ADR-049 的软删除。只有系统管理员与本项目组长可以
   * 调用（普通成员 403 `PROJECT_RESTORE_FORBIDDEN`，非成员 404），且只接受处于
   * 已删除状态的项目（未删除 409 `PROJECT_NOT_DELETED`）。
   *
   * 删除从未动过业务数据，因此还原不重建任何东西：只清空 `deleted_at` /
   * `deleted_by` 并递增 `row_version`，项目编码、成员关系、模块、任务与审计链
   * 原样回到各自读路径。审计 `project.restore`、项目动态 `PROJECT_RESTORED` 与
   * 搜索投影在同一事务提交；同样不发通知（成员要的是「项目回来了」本身，
   * 而不是一条需要再点一次的提醒）。
   */
  async restoreProject(
    tx: TransactionContext,
    input: {
      readonly actorId: number;
      readonly projectId: number;
      readonly requestId: string;
    },
  ): Promise<ProjectDetailResponse> {
    const role = await this.roles.projectRestorerRole(
      tx,
      input.actorId,
      input.projectId,
    );
    if (role === "NOT_MEMBER") throw missing();
    if (role === "MEMBER") throw restoreForbidden();
    const current = await this.projects.findDeletedProjectForChange(tx, {
      projectId: input.projectId,
    });
    if (current === undefined) {
      // 区分「没这个项目」（404）与「有但没被删除」（409）；后者只能靠未删除视图确认。
      const existing = await this.projects.findProjectForChange(tx, {
        projectId: input.projectId,
      });
      if (existing !== undefined) throw projectNotDeleted("restore");
      throw missing();
    }
    const updated = await this.projects.restoreProject(tx, {
      projectId: input.projectId,
    });
    if (updated === undefined) throw projectNotDeleted("restore");

    const occurredAt = new Date();
    const event = await this.audit.append(tx, {
      projectId: updated.projectId,
      actorType: "USER",
      actorId: input.actorId,
      action: "project.restore",
      targetType: "PROJECT",
      targetId: String(updated.projectId),
      eventPayload: {
        before: {
          deletedAt: current.deletedAt,
          deletedBy: current.deletedById,
          rowVersion: current.rowVersion,
        },
        after: {
          code: updated.code,
          name: updated.name,
          status: updated.status,
          rowVersion: updated.rowVersion,
        },
        actorRole: role,
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
      activityType: PROJECT_RESTORED_ACTIVITY,
      actorId: input.actorId,
      summary: `还原了项目 ${updated.name}`,
      metadata: {
        code: updated.code,
        role,
        deletedAt: current.deletedAt,
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
    return {
      project: this.toItem(updated),
      currentUserRole:
        (await this.members.findActiveRole(tx, {
          projectId: updated.projectId,
          userId: input.actorId,
        })) ?? null,
    };
  }

  /**
   * ADR-051 项目彻底删除（物理删除）：只允许系统管理员，且只接受已软删除的项目
   * （其余身份 403 `PROJECT_PURGE_FORBIDDEN`，未删除 409 `PROJECT_NOT_DELETED`）。
   *
   * 删除本身完全交给数据库的 `app.purge_project`：`app_runtime` 没有业务表的
   * DELETE 权限，只有这个 SECURITY DEFINER 窄口能在同一事务内按外键顺序清空
   * 模块、功能、任务、聚合组、迭代记录、遗留项、外部链接、成员关系、通知、
   * 动态、搜索投影与项目自己的 `PROJECT:<id>` 审计链。
   *
   * 唯一保留的记录是 SYSTEM 审计链上的 `project.purge`（操作者、项目编码与名称、
   * 删除前是谁删的、各表行数），因此项目行消失之后仍然查得到「谁在什么时候
   * 彻底删掉了哪个项目」；项目编码不回收。这是不可撤销操作，前端必须二次确认。
   */
  async purgeProject(
    tx: TransactionContext,
    input: {
      readonly actorId: number;
      readonly projectId: number;
      readonly requestId: string;
    },
  ): Promise<ProjectPurgeResponse> {
    const role = await this.roles.projectPurgerRole(input.actorId);
    if (role === "FORBIDDEN") throw purgeForbidden();
    const current = await this.projects.findDeletedProjectForChange(tx, {
      projectId: input.projectId,
    });
    if (current === undefined) {
      const existing = await this.projects.findProjectForChange(tx, {
        projectId: input.projectId,
      });
      if (existing !== undefined) throw projectNotDeleted("purge");
      throw missing();
    }
    const counts = await this.projects.purgeProject(tx, {
      projectId: input.projectId,
    });
    const occurredAt = new Date();
    await this.audit.append(tx, {
      // 项目链已随项目一起删除，本操作只能记在 SYSTEM 链上。
      projectId: null,
      actorType: "USER",
      actorId: input.actorId,
      action: "project.purge",
      targetType: "PROJECT",
      targetId: String(input.projectId),
      eventPayload: {
        code: current.code,
        name: current.name,
        deletedAt: current.deletedAt,
        deletedBy: { id: current.deletedById, name: current.deletedByName },
        actorRole: role,
        records: counts,
      },
      requestId: input.requestId,
      occurredAt,
    });
    return {
      purged: {
        projectId: input.projectId,
        code: current.code,
        name: current.name,
        records: counts,
      },
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
