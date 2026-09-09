import { randomUUID } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import { routeRegistry, schemaRegistry } from "@inpulse/api-contract";

import { AdminHighRiskError } from "../../auth/admin-high-risk.error.js";
import { AdminHighRiskAuthService } from "../../auth/admin-high-risk.service.js";
import { AuthenticatedMutationService } from "../../auth/authenticated-mutation.service.js";
import {
  getHeader,
  mutationSameOriginValidationError,
  type HttpHeaderBag,
} from "../../auth/csrf.http.js";
import { PostgresUnitOfWork } from "../../database/unit-of-work.js";
import {
  IdempotencyHttpError,
  IdempotencyHttpService,
} from "../../idempotency/http-service.js";
import { ProjectMemberTaskCommandError } from "../tasks/index.js";
import {
  ProjectMemberManagementError,
  ProjectMemberManagementService,
} from "./project-member-management.service.js";

export type ProjectMemberOperation =
  | "listProjectMembers"
  | "listProjectMemberUnfinishedTasks"
  | "addProjectMember"
  | "removeProjectMember";

export interface ProjectMemberHttpRequest {
  readonly headers: HttpHeaderBag;
  readonly params: unknown;
  readonly query: unknown;
  readonly body?: unknown;
}

class ProjectMemberHttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 422,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProjectMemberHttpError";
  }
}

class ProjectMemberInputError extends Error {
  constructor(readonly fields: Readonly<Record<string, string>>) {
    super("invalid project member request");
    this.name = "ProjectMemberInputError";
  }
}

/** F-05 成员管理 HTTP 编排：读路径独立事务，写路径由幂等 runner 持有单事务。 */
@Injectable()
export class ProjectMemberManagementHttpService {
  constructor(
    @Inject(AdminHighRiskAuthService)
    private readonly highRisk: AdminHighRiskAuthService,
    @Inject(AuthenticatedMutationService)
    private readonly mutation: AuthenticatedMutationService,
    @Inject(PostgresUnitOfWork) private readonly uow: PostgresUnitOfWork,
    @Inject(ProjectMemberManagementService)
    private readonly members: ProjectMemberManagementService,
    @Inject(IdempotencyHttpService)
    private readonly idempotency: IdempotencyHttpService,
  ) {}

  async handle(
    operation: ProjectMemberOperation,
    request: ProjectMemberHttpRequest,
  ): Promise<{ readonly status: number; readonly body: unknown }> {
    const requestId = randomUUID();
    try {
      const route = routeRegistry.find(
        (entry) => entry.operationId === operation,
      )!;
      const path = this.parsePath(operation, request.params);
      if (Object.keys((request.query ?? {}) as object).length) {
        throw new ProjectMemberInputError({ query: "此接口不接受查询参数" });
      }

      if (operation === "listProjectMembers") {
        const body = await this.uow.run(async (tx) => {
          await this.highRisk.verifyRead(tx, request.headers);
          return this.members.listMembers(tx, path.projectId);
        });
        return { status: 200, body };
      }

      if (operation === "listProjectMemberUnfinishedTasks") {
        const body = await this.uow.run(async (tx) => {
          await this.highRisk.verifyRead(tx, request.headers);
          return this.members.listUnfinishedTasks(
            tx,
            path.projectId,
            path.userId,
          );
        });
        return { status: 200, body };
      }

      const originFailure = mutationSameOriginValidationError(request.headers);
      if (originFailure !== undefined) {
        throw new ProjectMemberHttpError(
          403,
          "CSRF_ORIGIN_REJECTED",
          "请求未通过同源安全校验",
        );
      }
      if (
        operation === "addProjectMember" ||
        operation === "removeProjectMember"
      ) {
        const contentType = getHeader(request.headers, "content-type")
          ?.split(";")[0]
          ?.trim()
          .toLowerCase();
        if (contentType !== "application/json") {
          throw new ProjectMemberHttpError(
            400,
            "PROJECT_MEMBER_CONTENT_TYPE_INVALID",
            "请求必须使用 application/json",
          );
        }
      }
      const addBody =
        operation === "addProjectMember"
          ? this.parseAddBody(request.body)
          : undefined;
      const removeBody =
        operation === "removeProjectMember"
          ? this.parseRemoveBody(request.body)
          : undefined;
      const execute = async (
        tx: Parameters<ProjectMemberManagementService["addMember"]>[0],
        actorId: number,
      ) =>
        operation === "addProjectMember"
          ? this.members.addMember(tx, {
              actorId,
              projectId: path.projectId,
              userId: addBody!.userId,
              requestId,
            })
          : this.members.removeMember(tx, {
              actorId,
              projectId: path.projectId,
              userId: path.userId,
              request: removeBody!,
              requestId,
            });

      const result = await this.idempotency.run({
        operationId: operation,
        actorId: (tx) => this.resolveWriteActor(tx, request.headers),
        request: {
          method: route.method,
          path: route.path,
          pathParams: toPathParams(path),
          query: {},
          headers: request.headers,
          body: addBody ?? removeBody,
        },
        execute,
        replayAuthorizer: async (record, tx) => {
          const actorId = await this.resolveWriteActor(tx, request.headers);
          await this.members.replayAuthorizer(
            tx,
            actorId,
            record.replayAuthContext,
          );
        },
      });
      return {
        status: result.responseStatus,
        body: result.responseSchemaRef
          ? schemaRegistry[
              result.responseSchemaRef as keyof typeof schemaRegistry
            ].schema.parse(result.responseBody)
          : undefined,
      };
    } catch (error) {
      return this.mapError(error, requestId);
    }
  }

  private parsePath(
    operation: ProjectMemberOperation,
    value: unknown,
  ): { readonly projectId: number; readonly userId: number } {
    const schema =
      operation === "listProjectMemberUnfinishedTasks" ||
      operation === "removeProjectMember"
        ? schemaRegistry.ProjectMemberPath.schema
        : schemaRegistry.ProjectMemberCollectionPath.schema;
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      throw new ProjectMemberInputError({
        path: "项目或成员参数无效",
      });
    }
    return {
      projectId: parsed.data.projectId,
      userId:
        "userId" in parsed.data
          ? (parsed.data as { readonly userId: number }).userId
          : 0,
    };
  }

  private parseAddBody(value: unknown): { readonly userId: number } {
    const parsed =
      schemaRegistry.AddProjectMemberRequest.schema.safeParse(value);
    if (!parsed.success) {
      throw new ProjectMemberInputError({ body: "添加成员请求体无效" });
    }
    return parsed.data;
  }

  private parseRemoveBody(value: unknown): {
    reassignments: {
      taskId: number;
      moduleId: number;
      featureId: number | null;
      rowVersion: number;
      assigneeId: number;
    }[];
  } {
    const parsed =
      schemaRegistry.RemoveProjectMemberRequest.schema.safeParse(value);
    if (!parsed.success) {
      throw new ProjectMemberInputError({ body: "移除成员请求体无效" });
    }
    return parsed.data;
  }

  private async resolveWriteActor(
    tx: Parameters<ProjectMemberManagementService["addMember"]>[0],
    headers: HttpHeaderBag,
  ): Promise<number> {
    const actor = await this.mutation.verify(tx, headers);
    if (actor === undefined) {
      throw new ProjectMemberHttpError(
        401,
        "ADMIN_SESSION_REQUIRED",
        "需要有效的完整管理员 Session 与 CSRF Token",
      );
    }
    const verified = await this.highRisk.verify(tx, headers);
    if (verified.userId !== actor.userId) {
      throw new ProjectMemberHttpError(
        403,
        "ADMIN_REQUIRED",
        "管理员身份已变化，请重新验证",
      );
    }
    return actor.userId;
  }

  private mapError(
    error: unknown,
    requestId: string,
  ): { readonly status: number; readonly body: unknown } {
    if (error instanceof ProjectMemberManagementError) {
      return errorBody(error.status, error.code, error.message, requestId);
    }
    if (error instanceof ProjectMemberTaskCommandError) {
      return errorBody(error.status, error.code, error.message, requestId);
    }
    if (error instanceof ProjectMemberHttpError) {
      return errorBody(error.status, error.code, error.message, requestId);
    }
    if (error instanceof AdminHighRiskError) {
      return errorBody(error.status, error.code, error.message, requestId, {
        reason: error.reason,
      });
    }
    if (error instanceof IdempotencyHttpError) {
      return errorBody(error.status, error.code, error.message, requestId);
    }
    if (error instanceof ProjectMemberInputError) {
      return errorBody(
        422,
        "PROJECT_MEMBER_VALIDATION_FAILED",
        "请检查成员管理请求字段",
        requestId,
        {
          ...error.fields,
        },
      );
    }
    return errorBody(
      500,
      "INTERNAL_ERROR",
      "服务器无法完成项目成员管理操作",
      requestId,
    );
  }
}

function toPathParams(path: {
  readonly projectId: number;
  readonly userId?: number;
}): Readonly<Record<string, string>> {
  return {
    projectId: String(path.projectId),
    ...(path.userId === undefined || path.userId === 0
      ? {}
      : { userId: String(path.userId) }),
  };
}

function errorBody(
  status: number,
  code: string,
  message: string,
  requestId: string,
  details: Readonly<Record<string, unknown>> = {},
) {
  return {
    status,
    body: schemaRegistry.ErrorResponse.schema.parse({
      code,
      message,
      details,
      requestId,
    }),
  };
}
