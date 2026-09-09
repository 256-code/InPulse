import { Inject, Injectable } from "@nestjs/common";
import {
  projectMemberReplayContextSchema,
  type AddProjectMemberResponse,
  type ProjectMemberRecordItem,
  type ProjectMemberUnfinishedTasksResponse,
  type ProjectMembersListResponse,
  type RemoveProjectMemberResponse,
} from "@inpulse/api-contract";

import { AuditWritePort } from "../../audit/audit.port.js";
import type { TransactionContext } from "../../database/transaction-context.js";
import type { IdempotencyExecutionResult } from "../../idempotency/runner.js";
import { ActivityWritePort } from "../activity/index.js";
import { NotificationWritePort } from "../notifications/index.js";
import { ProjectMemberTaskCommandPort } from "../tasks/index.js";
import {
  PROJECT_ACCESS_QUERY_PORT,
  type ProjectAccessQueryPort,
} from "./project-access.port.js";
import {
  ActiveUsersQueryPort,
  type ProjectMemberRecord,
  type ProjectRecord,
  ProjectsWritePort,
} from "./projects-write.port.js";
import type { RemoveProjectMemberRequest } from "@inpulse/api-contract";

const PROJECT_MEMBER_ADD_ACTIVITY = "PROJECT_MEMBER_ADDED";
const PROJECT_MEMBER_REMOVE_ACTIVITY = "PROJECT_MEMBER_REMOVED";
const PROJECT_MEMBER_JOIN_NOTIFICATION = "PROJECT_JOINED";

export class ProjectMemberManagementError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 422,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProjectMemberManagementError";
  }
}

export interface ProjectMemberCommandResult extends IdempotencyExecutionResult {
  readonly body: AddProjectMemberResponse | RemoveProjectMemberResponse;
}

/**
 * F-05 项目成员管理：所有命令只接收显式 TransactionContext，
 * 成员读写、审计、活动与通知投影在同一个事务内提交。
 */
@Injectable()
export class ProjectMemberManagementService {
  constructor(
    @Inject(ProjectsWritePort) private readonly projects: ProjectsWritePort,
    @Inject(ActiveUsersQueryPort)
    private readonly activeUsers: ActiveUsersQueryPort,
    @Inject(PROJECT_ACCESS_QUERY_PORT)
    private readonly access: ProjectAccessQueryPort,
    @Inject(ProjectMemberTaskCommandPort)
    private readonly tasks: ProjectMemberTaskCommandPort,
    @Inject(AuditWritePort) private readonly audit: AuditWritePort,
    @Inject(ActivityWritePort) private readonly activity: ActivityWritePort,
    @Inject(NotificationWritePort)
    private readonly notifications: NotificationWritePort,
  ) {}

  async listMembers(
    tx: TransactionContext,
    projectId: number,
  ): Promise<ProjectMembersListResponse> {
    await this.requireReadProject(tx, projectId);
    const items = (await this.projects.listMembers(tx, { projectId })).map(
      (record) => this.toContractMember(record),
    );
    return { items };
  }

  async listUnfinishedTasks(
    tx: TransactionContext,
    projectId: number,
    userId: number,
  ): Promise<ProjectMemberUnfinishedTasksResponse> {
    await this.requireReadProject(tx, projectId);
    const member = await this.projects.findLatestMember(tx, {
      projectId,
      userId,
    });
    if (member === undefined || member.status !== "ACTIVE") {
      throw this.notFound();
    }
    const items = await this.tasks.listUnfinished(tx, projectId, userId);
    return { items };
  }

  async addMember(
    tx: TransactionContext,
    input: {
      readonly actorId: number;
      readonly projectId: number;
      readonly userId: number;
      readonly requestId: string;
    },
  ): Promise<ProjectMemberCommandResult> {
    const project = await this.requireWritableProject(tx, input);
    const active = await this.activeUsers.findActiveUserIds(tx, [input.userId]);
    if (active.length !== 1) {
      throw new ProjectMemberManagementError(
        422,
        "PROJECT_MEMBER_USER_INVALID",
        "目标用户不存在或已停用，不能添加为项目成员",
      );
    }
    const latest = await this.projects.findLatestMember(
      tx,
      { projectId: input.projectId, userId: input.userId },
      true,
    );
    if (latest?.status === "ACTIVE") {
      throw this.alreadyActive();
    }

    let member: ProjectMemberRecord;
    try {
      member = await this.projects.addMemberHistory(tx, {
        projectId: input.projectId,
        userId: input.userId,
      });
    } catch (error) {
      if (isActiveUniqueViolation(error)) {
        throw this.alreadyActive();
      }
      throw error;
    }

    const occurredAt = new Date();
    const event = await this.audit.append(tx, {
      projectId: project.projectId,
      actorType: "USER",
      actorId: input.actorId,
      action: "project.member.add",
      targetType: "USER",
      targetId: String(input.userId),
      eventPayload: {
        projectId: project.projectId,
        userId: input.userId,
        membershipId: member.membershipId,
        joinedAt: member.joinedAt,
      },
      requestId: input.requestId,
      occurredAt,
    });
    await this.activity.append(tx, {
      projectId: project.projectId,
      sourceChainId: event.chainId,
      sourceSequence: event.sequenceNo,
      sourceEntityType: "PROJECT",
      sourceEntityId: project.projectId,
      activityType: PROJECT_MEMBER_ADD_ACTIVITY,
      actorId: input.actorId,
      summary: `将用户 ${member.name} 添加为项目成员`,
      metadata: {
        userId: member.userId,
        membershipId: member.membershipId,
      },
      visibilityScope: "MEMBER",
      sourceStatus: project.status,
      sourceRowVersion: project.rowVersion,
      occurredAt,
    });
    await this.notifications.write(tx, {
      recipientId: member.userId,
      projectId: project.projectId,
      sourceChainId: event.chainId,
      sourceSequence: event.sequenceNo,
      notificationType: PROJECT_MEMBER_JOIN_NOTIFICATION,
      title: `已加入项目 ${project.name}`,
      body: "你已被系统管理员添加为项目成员",
      targetPath: `/projects/${project.projectId}/activity`,
      createdAt: occurredAt,
    });

    const body: AddProjectMemberResponse = {
      member: this.toContractMember(member),
    };
    return {
      responseStatus: 200,
      responseSchemaRef: "AddProjectMemberResponse",
      responseHasBody: true,
      responseBody: body,
      replayAuthContext: {
        projectId: project.projectId,
        memberUserId: member.userId,
      },
      body,
    };
  }

  async removeMember(
    tx: TransactionContext,
    input: {
      readonly actorId: number;
      readonly projectId: number;
      readonly userId: number;
      readonly request: RemoveProjectMemberRequest;
      readonly requestId: string;
    },
  ): Promise<ProjectMemberCommandResult> {
    const project = await this.requireWritableProject(tx, input);
    const latest = await this.projects.findLatestMember(tx, {
      projectId: input.projectId,
      userId: input.userId,
    });
    if (latest === undefined || latest.status !== "ACTIVE") {
      throw this.notFound();
    }

    const reassignedTaskIds = await this.tasks.reassign(tx, {
      actorId: input.actorId,
      projectId: input.projectId,
      targetUserId: input.userId,
      assignments: input.request.reassignments,
      requestId: input.requestId,
    });

    const removed = await this.projects.removeMember(tx, {
      projectId: input.projectId,
      userId: input.userId,
    });
    if (removed === undefined) {
      throw this.notFound();
    }
    const remaining = await this.tasks.listUnfinished(
      tx,
      input.projectId,
      input.userId,
    );

    const occurredAt = new Date();
    const event = await this.audit.append(tx, {
      projectId: project.projectId,
      actorType: "USER",
      actorId: input.actorId,
      action: "project.member.remove",
      targetType: "USER",
      targetId: String(input.userId),
      eventPayload: {
        projectId: project.projectId,
        userId: input.userId,
        membershipId: removed.membershipId,
        removedAt: removed.removedAt,
        reassignedTaskIds,
        unfinishedTaskCount: remaining.length,
      },
      requestId: input.requestId,
      occurredAt,
    });
    await this.activity.append(tx, {
      projectId: project.projectId,
      sourceChainId: event.chainId,
      sourceSequence: event.sequenceNo,
      sourceEntityType: "PROJECT",
      sourceEntityId: project.projectId,
      activityType: PROJECT_MEMBER_REMOVE_ACTIVITY,
      actorId: input.actorId,
      summary: `已将用户 ${removed.name} 移出项目`,
      metadata: {
        userId: removed.userId,
        membershipId: removed.membershipId,
        reassignedTaskIds,
        unfinishedTaskCount: remaining.length,
      },
      visibilityScope: "MEMBER",
      sourceStatus: project.status,
      sourceRowVersion: project.rowVersion,
      occurredAt,
    });

    const body: RemoveProjectMemberResponse = {
      member: this.toContractMember(removed),
      reassignedTaskIds,
      unfinishedTaskCount: remaining.length,
    };
    return {
      responseStatus: 200,
      responseSchemaRef: "RemoveProjectMemberResponse",
      responseHasBody: true,
      responseBody: body,
      replayAuthContext: {
        projectId: project.projectId,
        memberUserId: removed.userId,
      },
      body,
    };
  }

  async replayAuthorizer(
    tx: TransactionContext,
    actorId: number,
    context: unknown,
  ): Promise<void> {
    const parsed = projectMemberReplayContextSchema.safeParse(context);
    if (!parsed.success) {
      throw new Error("invalid project member replay context");
    }
    await this.requireWritableProject(tx, {
      actorId,
      projectId: parsed.data.projectId,
    });
    const project = await this.projects.findProject(tx, {
      projectId: parsed.data.projectId,
    });
    if (project === undefined) {
      throw this.notFound();
    }
    const member = await this.projects.findLatestMember(tx, {
      projectId: parsed.data.projectId,
      userId: parsed.data.memberUserId,
    });
    if (member === undefined) {
      throw this.notFound();
    }
  }

  private async requireReadProject(
    tx: TransactionContext,
    projectId: number,
  ): Promise<ProjectRecord> {
    const project = await this.projects.findProject(tx, { projectId });
    if (project === undefined) {
      throw this.notFound();
    }
    return project;
  }

  private async requireWritableProject(
    tx: TransactionContext,
    input: { readonly actorId: number; readonly projectId: number },
  ): Promise<ProjectRecord> {
    const check = await this.access.checkProjectForWrite(tx, {
      actorUserId: input.actorId,
      projectId: input.projectId,
    });
    if (check.kind === "not-found") {
      throw this.notFound();
    }
    if (check.kind === "parent-not-active") {
      throw new ProjectMemberManagementError(
        409,
        "PROJECT_MEMBER_PROJECT_ARCHIVED",
        "项目已归档，不能变更项目成员",
      );
    }
    const project = await this.projects.findProject(tx, {
      projectId: input.projectId,
    });
    if (project === undefined) {
      throw this.notFound();
    }
    return project;
  }

  private toContractMember(
    record: ProjectMemberRecord,
  ): ProjectMemberRecordItem {
    return {
      membershipId: record.membershipId,
      projectId: record.projectId,
      userId: record.userId,
      name: record.name,
      avatarUrl: record.avatarUrl,
      status: record.status,
      joinedAt: record.joinedAt,
      removedAt: record.removedAt,
    };
  }

  private notFound(): ProjectMemberManagementError {
    return new ProjectMemberManagementError(
      404,
      "PROJECT_MEMBER_NOT_FOUND",
      "项目或成员不存在，或当前身份无权访问",
    );
  }

  private alreadyActive(): ProjectMemberManagementError {
    return new ProjectMemberManagementError(
      409,
      "PROJECT_MEMBER_ALREADY_ACTIVE",
      "该用户已是项目活跃成员",
    );
  }
}

function isActiveUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505" &&
    "constraint_name" in error &&
    error.constraint_name === "project_members_active_unique"
  );
}
