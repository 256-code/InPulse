import { Inject, Injectable } from "@nestjs/common";
import type {
  CreateProjectRequest,
  CreateProjectResponse,
} from "@inpulse/api-contract";

import type { TransactionContext } from "../../database/transaction-context.js";
import { AuditWritePort } from "../../audit/audit.port.js";
import type { IdempotencyExecutionResult } from "../../idempotency/runner.js";
import { ModulesCommandPort } from "../modules/index.js";
import { SearchProjectionWritePort } from "../search/index.js";
import { ActivityWritePort } from "../activity/index.js";
import { NotificationWritePort } from "../notifications/index.js";
import {
  ActiveUsersQueryPort,
  ProjectsWritePort,
} from "./projects-write.port.js";
import { resolveProjectCode } from "./project-code.js";

const PROJECT_CREATE_ACTIVITY_TYPE = "PROJECT_CREATED";
const PROJECT_CREATE_NOTIFICATION_TYPE = "PROJECT_JOINED";

export class ProjectBootstrapValidationError extends Error {
  readonly code = "PROJECT_BOOTSTRAP_VALIDATION_ERROR" as const;
  readonly status = 422;

  constructor(message: string) {
    super(message);
    this.name = "ProjectBootstrapValidationError";
  }
}

export class ProjectBootstrapConflictError extends Error {
  readonly code = "PROJECT_BOOTSTRAP_CONFLICT" as const;
  readonly status = 409;

  constructor(message: string) {
    super(message);
    this.name = "ProjectBootstrapConflictError";
  }
}

export interface ProjectBootstrapDeps {
  readonly projects: ProjectsWritePort;
  readonly activeUsers: ActiveUsersQueryPort;
  readonly modules: ModulesCommandPort;
  readonly audit: AuditWritePort;
  readonly search: SearchProjectionWritePort;
  readonly activity: ActivityWritePort;
  readonly notifications: NotificationWritePort;
}

/**
 * F-04 项目创建单事务编排（技术设计 §6.2）。
 * 只接收显式 `TransactionContext`；创建者/初始成员 ACTIVE 校验、项目、未分类模块、
 * 审计、通知、活动与搜索投影全部在同一事务内。任一成员无效/停用/重复整笔回滚。
 */
@Injectable()
export class ProjectBootstrapWorkflow {
  constructor(
    @Inject(ProjectsWritePort) private readonly projects: ProjectsWritePort,
    @Inject(ActiveUsersQueryPort)
    private readonly activeUsers: ActiveUsersQueryPort,
    @Inject(ModulesCommandPort) private readonly modules: ModulesCommandPort,
    @Inject(AuditWritePort) private readonly audit: AuditWritePort,
    @Inject(SearchProjectionWritePort)
    private readonly search: SearchProjectionWritePort,
    @Inject(ActivityWritePort) private readonly activity: ActivityWritePort,
    @Inject(NotificationWritePort)
    private readonly notifications: NotificationWritePort,
  ) {}

  async execute(
    tx: TransactionContext,
    actorId: number,
    request: CreateProjectRequest,
  ): Promise<
    IdempotencyExecutionResult & { readonly body: CreateProjectResponse }
  > {
    let code: string;
    try {
      code = resolveProjectCode(request.name, request.code);
    } catch {
      throw new ProjectBootstrapValidationError(
        "项目编码无法从名称派生或请求编码无效",
      );
    }
    const project = await this.projects.createProject(tx, {
      code,
      name: request.name,
      description: request.description,
      createdBy: actorId,
    });

    const allMemberIds = Array.from(
      new Set([actorId, ...request.memberIds]),
    ).sort((a, b) => a - b);
    const activeIds = await this.activeUsers.findActiveUserIds(
      tx,
      allMemberIds,
    );
    if (activeIds.length !== allMemberIds.length) {
      throw new ProjectBootstrapValidationError("初始成员必须全部为已启用用户");
    }

    const memberRecords: {
      userId: number;
      status: "ACTIVE";
      joinedAt: string;
    }[] = [];
    for (const userId of allMemberIds) {
      const record = await this.projects.addMember(tx, {
        projectId: project.projectId,
        userId,
      });
      if (record.status !== "ACTIVE") {
        throw new ProjectBootstrapConflictError("项目成员必须为活跃状态");
      }
      memberRecords.push({
        userId: record.userId,
        status: record.status,
        joinedAt: record.joinedAt,
      });
    }

    const module = await this.modules.createUnclassifiedModule(tx, {
      projectId: project.projectId,
      createdBy: actorId,
    });

    const occurredAt = new Date();
    const requestId = `project-bootstrap:${project.projectId}`;
    const audit = await this.audit.append(tx, {
      projectId: project.projectId,
      actorType: "USER",
      actorId,
      action: "project.create",
      targetType: "PROJECT",
      targetId: String(project.projectId),
      eventPayload: {
        code: project.code,
        name: project.name,
        description: project.description,
      },
      requestId,
      occurredAt,
    });

    const chainId = audit.chainId;
    const sequenceNo = audit.sequenceNo;

    await this.search.upsert(tx, {
      projectId: project.projectId,
      entityType: "PROJECT",
      entityId: project.projectId,
      title: project.name,
      summary: project.description,
      rawText: `${project.code} ${project.name} ${project.description}`,
      visibilityScope: "MEMBER",
      sourceStatus: "ACTIVE",
      sourceRowVersion: 1,
    });

    await this.activity.append(tx, {
      projectId: project.projectId,
      sourceChainId: chainId,
      sourceSequence: sequenceNo,
      sourceEntityType: "PROJECT",
      sourceEntityId: project.projectId,
      activityType: PROJECT_CREATE_ACTIVITY_TYPE,
      actorId,
      summary: `创建了项目 ${project.name}`,
      metadata: { code: project.code },
      visibilityScope: "MEMBER",
      sourceStatus: "ACTIVE",
      sourceRowVersion: 1,
      occurredAt,
    });

    for (const memberId of allMemberIds) {
      await this.notifications.write(tx, {
        recipientId: memberId,
        projectId: project.projectId,
        sourceChainId: chainId,
        sourceSequence: sequenceNo,
        notificationType: PROJECT_CREATE_NOTIFICATION_TYPE,
        title: `已加入项目 ${project.name}`,
        body: "你已成为该项目的初始成员",
        targetPath: `/projects/${project.projectId}`,
        createdAt: occurredAt,
      });
    }

    const body: CreateProjectResponse = {
      project: {
        id: project.projectId,
        code: project.code,
        name: project.name,
        description: project.description,
        status: "ACTIVE",
        rowVersion: project.rowVersion,
        createdBy: project.createdBy,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      },
      members: memberRecords,
      unclassifiedModuleId: module.moduleId,
    };

    return {
      responseStatus: 200,
      responseSchemaRef: "CreateProjectResponse",
      responseHasBody: true,
      responseBody: body,
      replayAuthContext: {
        projectId: project.projectId,
        actorUserId: actorId,
      },
      body,
    };
  }
}
