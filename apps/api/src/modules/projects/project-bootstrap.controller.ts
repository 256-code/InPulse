import { randomUUID } from "node:crypto";

import { Controller, HttpCode, Post, Req, Res } from "@nestjs/common";

import {
  createProjectHeadersSchema,
  createProjectRequestSchema,
  type CreateProjectResponse,
} from "@inpulse/api-contract";
import { AuthenticatedMutationService } from "../../auth/authenticated-mutation.service.js";
import {
  getHeader,
  mutationSameOriginValidationError,
  type HttpHeaderBag,
} from "../../auth/csrf.http.js";
import {
  IdempotencyHttpError,
  IdempotencyHttpService,
} from "../../idempotency/http-service.js";
import type { TransactionContext } from "../../database/transaction-context.js";
import {
  ProjectBootstrapConflictError,
  ProjectBootstrapValidationError,
  ProjectBootstrapWorkflow,
} from "./project-bootstrap.workflow.js";

interface ProjectBootstrapControllerRequest {
  readonly headers: HttpHeaderBag;
  readonly body: unknown;
}

interface ProjectBootstrapControllerResponse {
  status(code: number): unknown;
}

interface ErrorResponseDto {
  readonly code: string;
  readonly message: string;
  readonly details: Readonly<Record<string, string>>;
  readonly requestId: string;
}

class ProjectBootstrapAuthError extends Error {
  readonly code = "PROJECT_BOOTSTRAP_UNAUTHENTICATED" as const;

  constructor() {
    super("current session or CSRF token is invalid");
    this.name = "ProjectBootstrapAuthError";
  }
}

/**
 * F-04 创建项目入口。只绑定 Route Registry 的 createProject，执行
 * Session/CSRF 解析与单事务编排；幂等、摘要与重放授权由 IdempotencyHttpService 承担。
 */
@Controller("projects")
export class ProjectBootstrapController {
  constructor(
    private readonly mutationAuth: AuthenticatedMutationService,
    private readonly idempotency: IdempotencyHttpService,
    private readonly workflow: ProjectBootstrapWorkflow,
  ) {}

  @Post()
  @HttpCode(200)
  async create(
    @Req() request: ProjectBootstrapControllerRequest,
    @Res({ passthrough: true }) response: ProjectBootstrapControllerResponse,
  ): Promise<CreateProjectResponse | ErrorResponseDto> {
    const requestId = randomUUID();
    const originFailure = mutationSameOriginValidationError(request.headers);
    if (originFailure !== undefined) {
      response.status(403);
      return csrfOriginFailureResponse(requestId, originFailure);
    }

    const parsedHeaders = createProjectHeadersSchema.safeParse({
      "x-csrf-token": getHeader(request.headers, "x-csrf-token"),
    });
    if (!parsedHeaders.success) {
      response.status(422);
      return validationResponse(requestId, "请求头缺少有效的同步 CSRF Token");
    }
    void parsedHeaders;

    const parsedBody = createProjectRequestSchema.safeParse(request.body);
    if (!parsedBody.success) {
      response.status(422);
      return validationResponse(
        requestId,
        "创建项目请求体字段无效",
        parsedErrorDetails(parsedBody.error.issues),
      );
    }

    try {
      const result = await this.idempotency.run({
        operationId: "createProject",
        actorId: async (tx) => this.resolveMutationActor(tx, request),
        request: {
          method: "POST",
          path: "/projects",
          pathParams: {},
          query: {},
          headers: request.headers,
          body: request.body,
        },
        execute: async (tx, actorId) =>
          this.workflow.execute(tx, actorId, parsedBody.data),
        replayAuthorizer: async (_record, tx) => {
          await this.resolveMutationActor(tx, request);
        },
      });
      response.status(result.responseStatus);
      return result.responseBody as CreateProjectResponse;
    } catch (error) {
      return this.mapMutationError(error, requestId, response);
    }
  }

  private async resolveMutationActor(
    tx: TransactionContext,
    request: ProjectBootstrapControllerRequest,
  ): Promise<number> {
    const actor = await this.mutationAuth.verify(tx, request.headers);
    if (actor === undefined) {
      throw new ProjectBootstrapAuthError();
    }
    return actor.userId;
  }

  private mapMutationError(
    error: unknown,
    requestId: string,
    response: ProjectBootstrapControllerResponse,
  ): ErrorResponseDto {
    if (error instanceof ProjectBootstrapAuthError) {
      response.status(401);
      return {
        code: error.code,
        message: "需要有效认证 Session 与 CSRF Token",
        details: {},
        requestId,
      };
    }
    if (error instanceof ProjectBootstrapValidationError) {
      response.status(error.status);
      return {
        code: error.code,
        message: error.message,
        details: {},
        requestId,
      };
    }
    if (error instanceof ProjectBootstrapConflictError) {
      response.status(error.status);
      return {
        code: error.code,
        message: error.message,
        details: {},
        requestId,
      };
    }
    if (error instanceof IdempotencyHttpError) {
      response.status(error.status);
      return {
        code: error.code,
        message: error.message,
        details: {},
        requestId,
      };
    }
    response.status(500);
    return {
      code: "INTERNAL_ERROR",
      message: "服务器无法完成项目创建",
      details: {},
      requestId,
    };
  }
}

function csrfOriginFailureResponse(
  requestId: string,
  reason: string,
): ErrorResponseDto {
  return {
    code: "CSRF_ORIGIN_REJECTED",
    message: "创建项目请求未通过同源或 Fetch Metadata 校验",
    details: { reason },
    requestId,
  };
}

function validationResponse(
  requestId: string,
  message: string,
  details: Readonly<Record<string, string>> = {},
): ErrorResponseDto {
  return {
    code: "PROJECT_VALIDATION_FAILED",
    message,
    details,
    requestId,
  };
}

function parsedErrorDetails(
  issues: readonly {
    readonly path: readonly PropertyKey[];
    readonly message: string;
  }[],
): Readonly<Record<string, string>> {
  const details: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.map((segment) => String(segment)).join(".");
    details[key] = issue.message;
  }
  return details;
}
