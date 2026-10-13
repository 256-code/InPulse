import { randomUUID } from "node:crypto";

import { Controller, Get, Put, Req, Res } from "@nestjs/common";
import {
  routeRegistry,
  schemaRegistry,
  wecomRobotReplayContextSchema,
  type WecomRobotConfigUpdateRequest,
} from "@inpulse/api-contract";

import { Operation } from "../../http/contract.decorators.js";
import { AdminHighRiskError } from "../../auth/admin-high-risk.error.js";
import { AdminHighRiskAuthService } from "../../auth/admin-high-risk.service.js";
import {
  getHeader,
  mutationSameOriginValidationError,
  type HttpHeaderBag,
} from "../../auth/csrf.http.js";
import type { TransactionContext } from "../../database/transaction-context.js";
import { PostgresUnitOfWork } from "../../database/unit-of-work.js";
import {
  IdempotencyHttpError,
  IdempotencyHttpService,
} from "../../idempotency/http-service.js";
import type { IdempotencyRecord } from "../../idempotency/store.js";
import {
  WecomRobotConfigError,
  WecomRobotInputError,
} from "./wecom-robot.error.js";
import { WecomRobotConfigService } from "./wecom-robot.service.js";

interface WecomRobotControllerRequest {
  readonly headers: HttpHeaderBag;
  readonly body?: unknown;
}

interface WecomRobotControllerResponse {
  status(code: number): unknown;
  setHeader(name: string, value: string): unknown;
}

class WecomRobotHttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 422,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "WecomRobotHttpError";
  }
}

/**
 * ADR-070 企业微信机器人管理员配置 HTTP 入口；只绑定 Route Registry。
 * GET 只读短事务；PUT 由幂等 runner 持有单事务，Secret 加密与审计同事务完成。
 */
@Controller("admin/wecom-robot")
export class WecomRobotController {
  constructor(
    private readonly unitOfWork: PostgresUnitOfWork,
    private readonly highRisk: AdminHighRiskAuthService,
    private readonly config: WecomRobotConfigService,
    private readonly idempotency: IdempotencyHttpService,
  ) {}

  @Get()
  @Operation("getWecomRobotConfig")
  async get(
    @Req() request: WecomRobotControllerRequest,
    @Res({ passthrough: true }) response: WecomRobotControllerResponse,
  ): Promise<unknown> {
    const requestId = randomUUID();
    try {
      const item = await this.unitOfWork.run((tx) =>
        this.config.view(tx, request.headers),
      );
      response.setHeader("Cache-Control", "no-store");
      return schemaRegistry.WecomRobotConfig.schema.parse(item);
    } catch (error) {
      return this.mapError(error, requestId, response);
    }
  }

  @Put()
  @Operation("updateWecomRobotConfig")
  async update(
    @Req() request: WecomRobotControllerRequest,
    @Res({ passthrough: true }) response: WecomRobotControllerResponse,
  ): Promise<unknown> {
    const requestId = randomUUID();
    try {
      if (mutationSameOriginValidationError(request.headers) !== undefined) {
        throw new WecomRobotHttpError(
          403,
          "CSRF_ORIGIN_REJECTED",
          "请求未通过同源安全校验",
        );
      }
      const route = routeRegistry.find(
        (entry) => entry.operationId === "updateWecomRobotConfig",
      )!;
      const body = this.parseWriteBody(route, request);
      const result = await this.idempotency.run({
        operationId: "updateWecomRobotConfig",
        actorId: async (tx) => {
          const actor = await this.highRisk.verify(tx, request.headers);
          return actor.userId;
        },
        request: {
          method: route.method,
          path: route.path,
          pathParams: {},
          query: {},
          headers: request.headers,
          body,
        },
        execute: async (tx, actorId) => {
          const item = await this.config.update(
            tx,
            {
              actorId,
              headers: request.headers,
              requestId,
            },
            body,
          );
          return {
            responseStatus: 200,
            responseSchemaRef: "WecomRobotConfig",
            responseHasBody: true,
            responseBody: item,
            replayAuthContext: { actorUserId: actorId, robotConfigRowId: 1 },
          };
        },
        replayAuthorizer: async (
          record: IdempotencyRecord,
          tx: TransactionContext,
        ) => {
          // 重放前重新验证当前完整管理员会话与 CSRF（ADR-070 / ADR-068 同款约束）。
          const actor = await this.highRisk.verify(tx, request.headers);
          const context = wecomRobotReplayContextSchema.parse(
            record.replayAuthContext,
          );
          if (context.actorUserId !== actor.userId) {
            throw new WecomRobotHttpError(
              403,
              "ADMIN_REQUIRED",
              "只有原管理员可以重放该配置保存请求",
            );
          }
        },
      });
      response.status(result.responseStatus);
      response.setHeader("Cache-Control", "no-store");
      return result.responseSchemaRef
        ? schemaRegistry[
            result.responseSchemaRef as keyof typeof schemaRegistry
          ].schema.parse(result.responseBody)
        : undefined;
    } catch (error) {
      return this.mapError(error, requestId, response);
    }
  }

  private parseWriteBody(
    route: (typeof routeRegistry)[number],
    request: WecomRobotControllerRequest,
  ): WecomRobotConfigUpdateRequest {
    if ("noBody" in route.request.body) {
      throw new WecomRobotHttpError(
        400,
        "WECOM_ROBOT_CONFIG_BODY_INVALID",
        "该接口不接受请求体",
      );
    }
    const contentType = getHeader(request.headers, "content-type")
      ?.split(";")[0]
      ?.trim()
      .toLowerCase();
    if (contentType !== "application/json") {
      throw new WecomRobotHttpError(
        400,
        "WECOM_ROBOT_CONFIG_CONTENT_TYPE_INVALID",
        "请求必须使用 application/json",
      );
    }
    const ref = route.request.body.contentTypes[0]!.schemaRef;
    const parsed = schemaRegistry[ref].schema.safeParse(request.body);
    if (!parsed.success) {
      throw new WecomRobotInputError(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [
            issue.path.join("."),
            issue.message,
          ]),
        ),
      );
    }
    return parsed.data as WecomRobotConfigUpdateRequest;
  }

  private mapError(
    error: unknown,
    requestId: string,
    response: WecomRobotControllerResponse,
  ): unknown {
    if (error instanceof WecomRobotConfigError) {
      response.status(error.status);
      return errorBody(error.status, error.code, error.message, {
        ...error.details,
        requestId,
      });
    }
    if (error instanceof WecomRobotHttpError) {
      response.status(error.status);
      return errorBody(error.status, error.code, error.message, { requestId });
    }
    if (error instanceof AdminHighRiskError) {
      response.status(error.status);
      return errorBody(error.status, error.code, error.message, {
        reason: error.reason,
        requestId,
      });
    }
    if (error instanceof IdempotencyHttpError) {
      response.status(error.status);
      return errorBody(error.status, error.code, error.message, { requestId });
    }
    if (error instanceof WecomRobotInputError) {
      response.status(422);
      return errorBody(
        422,
        "WECOM_ROBOT_CONFIG_VALIDATION_FAILED",
        "请检查企业微信机器人配置字段",
        { ...error.fields, requestId },
      );
    }
    response.status(500);
    return errorBody(
      500,
      "INTERNAL_ERROR",
      "服务器无法完成企业微信机器人配置操作",
      { requestId },
    );
  }
}

function errorBody(
  status: number,
  code: string,
  message: string,
  details: Readonly<Record<string, unknown>>,
): unknown {
  return schemaRegistry.ErrorResponse.schema.parse({
    code,
    message,
    details,
    requestId: details["requestId"] ?? "",
  });
}
