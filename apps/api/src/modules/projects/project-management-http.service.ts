import { SearchProjectionCapacityError } from "../search/public/search-projection-errors.js";
import { randomUUID } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import {
  routeRegistry,
  schemaRegistry,
  type ProjectArchiveRequest,
  type ProjectEditRequest,
} from "@inpulse/api-contract";

import { AdminHighRiskError } from "../../auth/admin-high-risk.error.js";
import { AdminHighRiskAuthService } from "../../auth/admin-high-risk.service.js";
import { AuthenticatedMutationService } from "../../auth/authenticated-mutation.service.js";
import { SessionAuthService } from "../../auth/session-auth.service.js";
import {
  getHeader,
  mutationSameOriginValidationError,
  type HttpHeaderBag,
} from "../../auth/csrf.http.js";
import { PostgresUnitOfWork } from "../../database/unit-of-work.js";
import type { TransactionContext } from "../../database/transaction-context.js";
import {
  IdempotencyHttpError,
  IdempotencyHttpService,
} from "../../idempotency/http-service.js";
import {
  ProjectManagementError,
  ProjectManagementService,
} from "./project-management.service.js";

export type ProjectManagementOperation =
  | "updateProject"
  | "getProjectArchivePreview"
  | "archiveProject"
  | "restoreProject";

export interface ProjectManagementHttpRequest {
  readonly headers: HttpHeaderBag;
  readonly params: unknown;
  readonly query: unknown;
  readonly body?: unknown;
}

class ProjectInputError extends Error {
  constructor(readonly fields: Readonly<Record<string, string>>) {
    super("invalid project management request");
    this.name = "ProjectInputError";
  }
}

class ProjectBodyValidationError extends Error {
  constructor(readonly details: string) {
    super("invalid project management body");
    this.name = "ProjectBodyValidationError";
  }
}

/**
 * F-06 项目编辑/归档/恢复 HTTP 编排：写路径由幂等 runner 持有单事务；
 * 归档预览为管理员只读路径，独立事务且不做状态变更。
 */
@Injectable()
export class ProjectManagementHttpService {
  constructor(
    @Inject(SessionAuthService) private readonly auth: SessionAuthService,
    @Inject(AuthenticatedMutationService)
    private readonly mutation: AuthenticatedMutationService,
    @Inject(AdminHighRiskAuthService)
    private readonly highRisk: AdminHighRiskAuthService,
    @Inject(PostgresUnitOfWork) private readonly uow: PostgresUnitOfWork,
    @Inject(IdempotencyHttpService)
    private readonly idempotency: IdempotencyHttpService,
    @Inject(ProjectManagementService)
    private readonly projects: ProjectManagementService,
  ) {}

  async handle(
    operation: ProjectManagementOperation,
    request: ProjectManagementHttpRequest,
  ): Promise<{ readonly status: number; readonly body: unknown }> {
    const requestId = randomUUID();
    try {
      const route = routeRegistry.find(
        (entry) => entry.operationId === operation,
      )!;
      if (route.request.path === "none") {
        throw new Error("project route requires path schema");
      }
      const path = schemaRegistry.ProjectPath.schema.safeParse(request.params);
      if (!path.success) {
        throw new ProjectInputError({ path: "项目参数无效" });
      }
      if (Object.keys((request.query ?? {}) as object).length) {
        throw new ProjectInputError({ query: "此接口不接受查询参数" });
      }

      if (operation === "getProjectArchivePreview") {
        const preview = await this.uow.run(async (tx) => {
          const actor = await this.auth.resolveActorInTransaction(
            tx,
            getHeader(request.headers, "cookie"),
          );
          if (actor === undefined) {
            throw new ProjectManagementError(
              401,
              "PROJECT_SESSION_REQUIRED",
              "请先登录",
            );
          }
          const body = await this.projects.archivePreview(
            tx,
            actor.userId,
            path.data.projectId,
          );
          await this.highRisk.verifyRead(tx, request.headers);
          return body;
        });
        return {
          status: 200,
          body: schemaRegistry.ProjectArchivePreviewResponse.schema.parse(
            preview,
          ),
        };
      }

      if (mutationSameOriginValidationError(request.headers) !== undefined) {
        throw new ProjectManagementError(
          403,
          "CSRF_ORIGIN_REJECTED",
          "请求未通过同源安全校验",
        );
      }
      if (route.request.headers === "none") {
        throw new Error("project write route requires header schema");
      }
      const parsedHeaders =
        schemaRegistry.ProjectVersionHeaders.schema.safeParse({
          "x-csrf-token": getHeader(request.headers, "x-csrf-token"),
          "if-match": getHeader(request.headers, "if-match"),
        });
      if (!parsedHeaders.success) {
        throw new ProjectInputError(
          Object.fromEntries(
            parsedHeaders.error.issues.map((issue) => [
              issue.path.join(".") || "headers",
              issue.message,
            ]),
          ),
        );
      }
      if (
        getHeader(request.headers, "content-type")
          ?.split(";")[0]
          ?.trim()
          .toLowerCase() !== "application/json"
      ) {
        throw new ProjectManagementError(
          400,
          "PROJECT_CONTENT_TYPE_INVALID",
          "请求必须使用 application/json",
        );
      }
      if (!("contentTypes" in route.request.body)) {
        throw new Error("project write route requires body schema");
      }
      const parsedBody = schemaRegistry[
        route.request.body.contentTypes[0]!.schemaRef
      ].schema.safeParse(request.body);
      if (!parsedBody.success) {
        throw new ProjectBodyValidationError(
          parsedBody.error.issues
            .map((issue) => issue.path.join(".") || "body")
            .join(","),
        );
      }
      const version = Number(parsedHeaders.data["if-match"].slice(1, -1));

      const highRisk = operation !== "updateProject";
      const resolve = async (tx: TransactionContext): Promise<number> => {
        const current = await this.mutation.verify(tx, request.headers);
        if (current === undefined) {
          throw new ProjectManagementError(
            401,
            "PROJECT_SESSION_REQUIRED",
            "登录或 CSRF 状态已失效",
          );
        }
        // 只做当前可读性与管理员门禁；ACTIVE 写前置条件由服务在执行/重放时判定。
        await this.projects.authorizeArchived(
          tx,
          current.userId,
          path.data.projectId,
        );
        if (highRisk) await this.highRisk.verify(tx, request.headers);
        return current.userId;
      };

      const result = await this.idempotency.run({
        operationId: operation,
        actorId: resolve,
        request: {
          method: route.method,
          path: route.path,
          pathParams: { projectId: String(path.data.projectId) },
          query: {},
          headers: request.headers,
          body: parsedBody.data,
        },
        execute: async (tx, actorId) => {
          const body =
            operation === "updateProject"
              ? await this.projects.updateProject(tx, {
                  actorId,
                  projectId: path.data.projectId,
                  version,
                  edit: parsedBody.data as ProjectEditRequest,
                  requestId,
                })
              : operation === "archiveProject"
                ? await this.projects.archiveProject(tx, {
                    actorId,
                    projectId: path.data.projectId,
                    version,
                    reason: (parsedBody.data as ProjectArchiveRequest).reason,
                    requestId,
                  })
                : await this.projects.restoreProject(tx, {
                    actorId,
                    projectId: path.data.projectId,
                    version,
                    reason: (parsedBody.data as ProjectArchiveRequest).reason,
                    requestId,
                  });
          return {
            responseStatus: 200,
            responseSchemaRef: "ProjectDetailResponse",
            responseHasBody: true,
            responseBody: body,
            replayAuthContext: { projectId: path.data.projectId },
          };
        },
        replayAuthorizer: async (record, tx) => {
          const actorId = await resolve(tx);
          await this.projects.replay(tx, actorId, record.replayAuthContext, {
            allowArchived: operation !== "updateProject",
          });
        },
      });
      return {
        status: result.responseStatus,
        body: schemaRegistry.ProjectDetailResponse.schema.parse(
          result.responseBody,
        ),
      };
    } catch (error) {
      return this.mapError(error, requestId);
    }
  }

  private mapError(
    error: unknown,
    requestId: string,
  ): { readonly status: number; readonly body: unknown } {
    if (
      error instanceof ProjectManagementError ||
      error instanceof SearchProjectionCapacityError
    ) {
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
    if (error instanceof ProjectInputError) {
      return errorBody(
        422,
        "PROJECT_VALIDATION_FAILED",
        "请检查项目请求字段",
        requestId,
        { ...error.fields },
      );
    }
    if (error instanceof ProjectBodyValidationError) {
      return errorBody(
        422,
        "PROJECT_VALIDATION_FAILED",
        "请检查项目请求字段",
        requestId,
        { body: error.details },
      );
    }
    return errorBody(
      500,
      "INTERNAL_ERROR",
      "服务器无法完成项目操作",
      requestId,
    );
  }
}

function errorBody(
  status: number,
  code: string,
  message: string,
  requestId: string,
  details: Readonly<Record<string, unknown>> = {},
): { readonly status: number; readonly body: unknown } {
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
