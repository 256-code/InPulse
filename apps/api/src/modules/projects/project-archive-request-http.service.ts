import { randomUUID } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import {
  routeRegistry,
  schemaRegistry,
  type ProjectArchiveRejectionRequest,
  type ProjectArchiveRequestSubmission,
} from "@inpulse/api-contract";

import { AdminHighRiskError } from "../../auth/admin-high-risk.error.js";
import { AdminHighRiskAuthService } from "../../auth/admin-high-risk.service.js";
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
import { SearchProjectionCapacityError } from "../search/public/search-projection-errors.js";
import {
  ProjectArchiveRequestError,
  ProjectArchiveRequestService,
} from "./project-archive-request.service.js";

export type ProjectArchiveRequestOperation =
  "requestProjectArchive" | "approveProjectArchive" | "rejectProjectArchive";

export interface ProjectArchiveHttpRequest {
  readonly headers: HttpHeaderBag;
  readonly params: unknown;
  readonly query: unknown;
  readonly body?: unknown;
}

class ProjectArchiveInputError extends Error {
  constructor(readonly fields: Readonly<Record<string, string>>) {
    super("invalid project archive request");
    this.name = "ProjectArchiveInputError";
  }
}

/**
 * F-06.2 项目归档申请 HTTP 编排：写路径全部由幂等 runner 持有单事务；
 * 申请走普通认证 Session，审核只允许当前有效的完整管理员 Session。
 */
@Injectable()
export class ProjectArchiveRequestHttpService {
  constructor(
    @Inject(AuthenticatedMutationService)
    private readonly mutation: AuthenticatedMutationService,
    @Inject(AdminHighRiskAuthService)
    private readonly highRisk: AdminHighRiskAuthService,
    @Inject(IdempotencyHttpService)
    private readonly idempotency: IdempotencyHttpService,
    @Inject(ProjectArchiveRequestService)
    private readonly requests: ProjectArchiveRequestService,
  ) {}

  async handle(
    operation: ProjectArchiveRequestOperation,
    request: ProjectArchiveHttpRequest,
  ): Promise<{ readonly status: number; readonly body: unknown }> {
    const traceId = randomUUID();
    try {
      const route = routeRegistry.find(
        (entry) => entry.operationId === operation,
      )!;
      if (route.request.path === "none") {
        throw new Error("archive request route requires path schema");
      }
      const versioned = operation === "approveProjectArchive";
      // 只有发起申请是单段项目路径；批准与驳回都带 requestId，
      // 必须按两段路径校验，否则合法的驳回请求会被判 422。
      const pathSchema =
        operation === "requestProjectArchive"
          ? schemaRegistry.ProjectPath
          : schemaRegistry.ProjectArchiveRequestPath;
      const parsedPath = pathSchema.schema.safeParse(request.params);
      if (!parsedPath.success) {
        throw new ProjectArchiveInputError({ path: "项目或申请参数无效" });
      }
      const path = parsedPath.data as {
        readonly projectId: number;
        readonly requestId?: number;
      };
      if (Object.keys((request.query ?? {}) as object).length) {
        throw new ProjectArchiveInputError({ query: "此接口不接受查询参数" });
      }
      if (mutationSameOriginValidationError(request.headers) !== undefined) {
        throw new ProjectArchiveRequestError(
          403,
          "CSRF_ORIGIN_REJECTED",
          "请求未通过同源安全校验",
        );
      }
      if (route.request.headers === "none") {
        throw new Error("archive request route requires header schema");
      }
      const headerSchema = versioned
        ? schemaRegistry.ProjectVersionHeaders
        : schemaRegistry.ProjectMutationHeaders;
      const parsedHeaders = headerSchema.schema.safeParse(
        versioned
          ? {
              "x-csrf-token": getHeader(request.headers, "x-csrf-token"),
              "if-match": getHeader(request.headers, "if-match"),
            }
          : { "x-csrf-token": getHeader(request.headers, "x-csrf-token") },
      );
      if (!parsedHeaders.success) {
        throw new ProjectArchiveInputError(
          Object.fromEntries(
            parsedHeaders.error.issues.map((issue) => [
              issue.path.join(".") || "headers",
              issue.message,
            ]),
          ),
        );
      }
      const version = versioned
        ? Number(
            (parsedHeaders.data as unknown as { "if-match": string })[
              "if-match"
            ].slice(1, -1),
          )
        : 0;

      let body: unknown;
      if ("contentTypes" in route.request.body) {
        if (
          getHeader(request.headers, "content-type")
            ?.split(";")[0]
            ?.trim()
            .toLowerCase() !== "application/json"
        ) {
          throw new ProjectArchiveRequestError(
            400,
            "PROJECT_CONTENT_TYPE_INVALID",
            "请求必须使用 application/json",
          );
        }
        const parsedBody = schemaRegistry[
          route.request.body.contentTypes[0]!.schemaRef
        ].schema.safeParse(request.body);
        if (!parsedBody.success) {
          throw new ProjectArchiveInputError({
            body: parsedBody.error.issues
              .map((issue) => issue.path.join(".") || "body")
              .join(","),
          });
        }
        body = parsedBody.data;
      }

      const adminOnly = operation !== "requestProjectArchive";
      const resolve = async (tx: TransactionContext): Promise<number> => {
        const current = await this.mutation.verify(tx, request.headers);
        if (current === undefined) {
          throw new ProjectArchiveRequestError(
            401,
            "PROJECT_SESSION_REQUIRED",
            "登录或 CSRF 状态已失效",
          );
        }
        if (adminOnly) await this.highRisk.verify(tx, request.headers);
        return current.userId;
      };

      const result = await this.idempotency.run({
        operationId: operation,
        actorId: resolve,
        request: {
          method: route.method,
          path: route.path,
          pathParams: Object.fromEntries(
            Object.entries(path)
              .filter(([, value]) => value !== undefined)
              .map(([key, value]) => [key, String(value)]),
          ),
          query: {},
          headers: request.headers,
          body: body ?? {},
        },
        execute: async (tx, actorId) => {
          if (operation === "requestProjectArchive") {
            const created = await this.requests.submit(tx, {
              actorId,
              projectId: path.projectId,
              reason: (body as ProjectArchiveRequestSubmission).reason,
              traceId,
            });
            return {
              responseStatus: 200,
              responseSchemaRef: "ProjectArchiveRequestItem" as const,
              responseHasBody: true,
              responseBody: created,
              replayAuthContext: {
                projectId: created.projectId,
                requestId: created.id,
              },
            };
          }
          if (operation === "approveProjectArchive") {
            const detail = await this.requests.approve(tx, {
              actorId,
              projectId: path.projectId,
              archiveRequestId: path.requestId!,
              version,
              traceId,
            });
            return {
              responseStatus: 200,
              responseSchemaRef: "ProjectDetailResponse" as const,
              responseHasBody: true,
              responseBody: detail,
              replayAuthContext: {
                projectId: path.projectId,
                requestId: path.requestId!,
              },
            };
          }
          const rejected = await this.requests.reject(tx, {
            actorId,
            projectId: path.projectId,
            archiveRequestId: path.requestId!,
            note: (body as ProjectArchiveRejectionRequest).note,
            traceId,
          });
          return {
            responseStatus: 200,
            responseSchemaRef: "ProjectArchiveRequestItem" as const,
            responseHasBody: true,
            responseBody: rejected,
            replayAuthContext: {
              projectId: rejected.projectId,
              requestId: rejected.id,
            },
          };
        },
        replayAuthorizer: async (record, tx) => {
          const actorId = await resolve(tx);
          await this.requests.replay(tx, actorId, record.replayAuthContext, {
            systemAdminOnly: adminOnly,
          });
        },
      });

      return {
        status: result.responseStatus,
        body: versioned
          ? schemaRegistry.ProjectDetailResponse.schema.parse(
              result.responseBody,
            )
          : schemaRegistry.ProjectArchiveRequestItem.schema.parse(
              result.responseBody,
            ),
      };
    } catch (error) {
      return this.mapError(error, traceId);
    }
  }

  private mapError(
    error: unknown,
    traceId: string,
  ): { readonly status: number; readonly body: unknown } {
    if (
      error instanceof ProjectArchiveRequestError ||
      error instanceof SearchProjectionCapacityError
    ) {
      return errorBody(error.status, error.code, error.message, traceId);
    }
    if (error instanceof AdminHighRiskError) {
      return errorBody(error.status, error.code, error.message, traceId, {
        reason: error.reason,
      });
    }
    if (error instanceof IdempotencyHttpError) {
      return errorBody(error.status, error.code, error.message, traceId);
    }
    if (error instanceof ProjectArchiveInputError) {
      return errorBody(
        422,
        "PROJECT_VALIDATION_FAILED",
        "请检查项目归档申请字段",
        traceId,
        { ...error.fields },
      );
    }
    return errorBody(
      500,
      "INTERNAL_ERROR",
      "服务器无法完成项目归档申请",
      traceId,
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
