import { SearchProjectionCapacityError } from "../search/public/search-projection-errors.js";
import { randomUUID } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import {
  routeRegistry,
  schemaRegistry,
  type ProjectEditRequest,
  type ProjectStatusChangeRequest,
} from "@inpulse/api-contract";

import { AdminHighRiskError } from "../../auth/admin-high-risk.error.js";
import { AuthenticatedMutationService } from "../../auth/authenticated-mutation.service.js";
import {
  getHeader,
  mutationSameOriginValidationError,
  type HttpHeaderBag,
} from "../../auth/csrf.http.js";
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
  "updateProject" | "changeProjectStatus";

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
 * F-06 项目编辑与状态变更 HTTP 编排：写路径由幂等 runner 持有单事务，
 * 权限在事务内按实时成员关系判定；项目三态下不再有归档/恢复操作。
 */
@Injectable()
export class ProjectManagementHttpService {
  constructor(
    @Inject(AuthenticatedMutationService)
    private readonly mutation: AuthenticatedMutationService,
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

      // 编辑与状态变更只要求有效 Session，权限由服务内的成员角色门禁判定。
      const resolve = async (tx: TransactionContext): Promise<number> => {
        const current = await this.mutation.verify(tx, request.headers);
        if (current === undefined) {
          throw new ProjectManagementError(
            401,
            "PROJECT_SESSION_REQUIRED",
            "登录或 CSRF 状态已失效",
          );
        }
        // 只做当前可读性；写前置条件由服务在执行/重放时判定。
        await this.projects.authorize(tx, current.userId, path.data.projectId);
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
              : await this.projects.changeProjectStatus(tx, {
                  actorId,
                  projectId: path.data.projectId,
                  version,
                  target: (parsedBody.data as ProjectStatusChangeRequest)
                    .status,
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
          await this.projects.replay(tx, actorId, record.replayAuthContext);
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
