import { randomUUID } from "node:crypto";

import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";

import { ContractHeaders, Operation } from "../../http/contract.decorators.js";
import { AuthenticatedMutationService } from "../../auth/authenticated-mutation.service.js";
import {
  getHeader,
  mutationSameOriginValidationError,
  type HttpHeaderBag,
} from "../../auth/csrf.http.js";
import { StrictSameOriginGuard } from "../../auth/csrf.guard.js";
import { SessionAuthService } from "../../auth/session-auth.service.js";
import { PostgresUnitOfWork } from "../../database/unit-of-work.js";
import {
  IdempotencyHttpError,
  IdempotencyHttpService,
} from "../../idempotency/http-service.js";
import type { TransactionContext } from "../../database/transaction-context.js";
import { WecomBindingStateService } from "./wecom-binding.service.js";

interface WecomBindingControllerRequest {
  readonly headers: HttpHeaderBag;
}

interface WecomBindingControllerResponse {
  status(code: number): unknown;
  setHeader(name: string, value: string | readonly string[]): unknown;
}

interface ErrorResponseDto {
  readonly code: string;
  readonly message: string;
  readonly details: Readonly<Record<string, string>>;
  readonly requestId: string;
}

class WecomBindingAuthError extends Error {
  readonly code = "WECOM_BINDING_UNAUTHENTICATED" as const;

  constructor() {
    super("current session or CSRF token is invalid");
    this.name = "WecomBindingAuthError";
  }
}

/**
 * ADR-069 企业微信机器人绑定入口（用户自助）。
 * GET 读取绑定状态；POST codes 签发一次性绑定码（securityFlow，CSRF 必填，
 * 不经通用幂等记录）；DELETE 解除绑定（数据库级幂等，actorOnly 重放授权）。
 * 三条路由都只读写当前登录用户自己的绑定与绑定码，不接受客户端指定用户。
 */
@Controller("me/wecom-binding")
export class WecomBindingController {
  constructor(
    private readonly sessionAuth: SessionAuthService,
    private readonly mutationAuth: AuthenticatedMutationService,
    private readonly unitOfWork: PostgresUnitOfWork,
    private readonly stateService: WecomBindingStateService,
    private readonly idempotency: IdempotencyHttpService,
  ) {}

  @Get()
  @Operation("getWecomBinding")
  async status(
    @Req() request: WecomBindingControllerRequest,
    @Res({ passthrough: true }) response: WecomBindingControllerResponse,
  ): Promise<unknown | ErrorResponseDto> {
    const requestId = randomUUID();
    const actor = await this.sessionAuth.resolveActor(
      getHeader(request.headers, "cookie"),
    );
    if (actor === undefined) {
      return unauthorized(requestId, response);
    }
    try {
      const status = await this.stateService.status(actor.userId);
      response.setHeader("Cache-Control", "no-store");
      return status;
    } catch {
      response.status(500);
      return internalError(requestId);
    }
  }

  @Post("codes")
  @HttpCode(201)
  @UseGuards(StrictSameOriginGuard)
  @Operation("createWecomBindingCode")
  async createCode(
    @Req() request: WecomBindingControllerRequest,
    @Res({ passthrough: true }) response: WecomBindingControllerResponse,
    @ContractHeaders("createWecomBindingCode") _headers: unknown = undefined,
  ): Promise<unknown | ErrorResponseDto> {
    const requestId = randomUUID();
    const originFailure = mutationSameOriginValidationError(request.headers);
    if (originFailure !== undefined) {
      return csrfOriginFailure(requestId, response, originFailure);
    }
    try {
      const created = await this.unitOfWork.run(async (tx) => {
        const actor = await this.mutationAuth.verify(tx, request.headers);
        if (actor === undefined) {
          throw new WecomBindingAuthError();
        }
        return this.stateService.createCode(tx, actor.userId);
      });
      response.status(201);
      // 一次性明文码只返回这一次：禁止任何缓存与落盘复用。
      response.setHeader("Cache-Control", "no-store");
      return { code: created.code, expiresAt: created.expiresAt };
    } catch (error) {
      return this.mapMutationError(error, requestId, response);
    }
  }

  @Delete()
  @HttpCode(204)
  @UseGuards(StrictSameOriginGuard)
  @Operation("deleteWecomBinding")
  async remove(
    @Req() request: WecomBindingControllerRequest,
    @Res({ passthrough: true }) response: WecomBindingControllerResponse,
    @ContractHeaders("deleteWecomBinding") _headers: unknown = undefined,
  ): Promise<ErrorResponseDto | undefined> {
    const requestId = randomUUID();
    const originFailure = mutationSameOriginValidationError(request.headers);
    if (originFailure !== undefined) {
      return csrfOriginFailure(requestId, response, originFailure);
    }
    try {
      const result = await this.idempotency.run({
        operationId: "deleteWecomBinding",
        actorId: async (tx) => this.resolveMutationActor(tx, request),
        request: {
          method: "DELETE",
          path: "/me/wecom-binding",
          pathParams: {},
          query: {},
          headers: request.headers,
          body: undefined,
        },
        execute: async (tx, actorId) => {
          await this.stateService.revoke(tx, actorId);
          return {
            responseStatus: 204,
            responseSchemaRef: null,
            responseHasBody: false,
            responseBody: null,
            replayAuthContext: { actorUserId: actorId },
          };
        },
        replayAuthorizer: async (_record, tx) => {
          await this.resolveMutationActor(tx, request);
        },
      });
      response.status(result.responseStatus);
      return undefined;
    } catch (error) {
      return this.mapMutationError(error, requestId, response);
    }
  }

  private async resolveMutationActor(
    tx: TransactionContext,
    request: WecomBindingControllerRequest,
  ): Promise<number> {
    const actor = await this.mutationAuth.verify(tx, request.headers);
    if (actor === undefined) {
      throw new WecomBindingAuthError();
    }
    return actor.userId;
  }

  private mapMutationError(
    error: unknown,
    requestId: string,
    response: WecomBindingControllerResponse,
  ): ErrorResponseDto {
    if (error instanceof WecomBindingAuthError) {
      response.status(401);
      return {
        code: error.code,
        message: "需要有效认证 Session 与 CSRF Token",
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
    return internalError(requestId);
  }
}

function unauthorized(
  requestId: string,
  response: WecomBindingControllerResponse,
): ErrorResponseDto {
  response.status(401);
  return {
    code: "WECOM_BINDING_UNAUTHENTICATED",
    message: "需要有效认证 Session 才能查看企业微信绑定",
    details: {},
    requestId,
  };
}

function csrfOriginFailure(
  requestId: string,
  response: WecomBindingControllerResponse,
  reason: string,
): ErrorResponseDto {
  response.status(403);
  return {
    code: "CSRF_ORIGIN_REJECTED",
    message: "请求未通过同源或 Fetch Metadata 校验",
    details: { reason },
    requestId,
  };
}

function internalError(requestId: string): ErrorResponseDto {
  return {
    code: "INTERNAL_ERROR",
    message: "服务器无法完成企业微信绑定操作",
    details: {},
    requestId,
  };
}
