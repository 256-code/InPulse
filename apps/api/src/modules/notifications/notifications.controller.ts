import { randomUUID } from "node:crypto";

import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";

import {
  notificationPathSchema,
  notificationQueryRequestSchema,
} from "@inpulse/api-contract";
import { AuthenticatedMutationService } from "../../auth/authenticated-mutation.service.js";
import {
  getHeader,
  mutationSameOriginValidationError,
  type HttpHeaderBag,
} from "../../auth/csrf.http.js";
import { SessionAuthService } from "../../auth/session-auth.service.js";
import {
  IdempotencyHttpError,
  IdempotencyHttpService,
} from "../../idempotency/http-service.js";
import type { TransactionContext } from "../../database/transaction-context.js";
import {
  NotificationNotFoundError,
  NotificationStateService,
} from "./notification.service.js";
import {
  NotificationQueryService,
  NotificationQueryValidationError,
} from "./notification-query.service.js";

interface NotificationControllerRequest {
  readonly headers: HttpHeaderBag;
}

interface NotificationControllerResponse {
  status(code: number): unknown;
}

interface ErrorResponseDto {
  readonly code: string;
  readonly message: string;
  readonly details: Readonly<Record<string, string>>;
  readonly requestId: string;
}

class NotificationAuthError extends Error {
  readonly code = "NOTIFICATION_UNAUTHENTICATED" as const;

  constructor() {
    super("current session or CSRF token is invalid");
    this.name = "NotificationAuthError";
  }
}

/**
 * F-28 站内通知入口。查询强制当前用户；写操作在同一幂等事务内重新校验
 * Session/CSRF，按 `recipient_id` 条件更新，不接受客户端指定收件人。
 */
@Controller("notifications")
export class NotificationsController {
  constructor(
    private readonly sessionAuth: SessionAuthService,
    private readonly mutationAuth: AuthenticatedMutationService,
    private readonly queryService: NotificationQueryService,
    private readonly stateService: NotificationStateService,
    private readonly idempotency: IdempotencyHttpService,
  ) {}

  @Get()
  async list(
    @Req() request: NotificationControllerRequest,
    @Res({ passthrough: true }) response: NotificationControllerResponse,
    @Query() query: unknown,
  ): Promise<unknown | ErrorResponseDto> {
    const requestId = randomUUID();
    const actor = await this.sessionAuth.resolveActor(
      getHeader(request.headers, "cookie"),
    );
    if (actor === undefined) {
      return unauthorized(requestId, response);
    }
    const parsed = notificationQueryRequestSchema.safeParse(query);
    if (!parsed.success) {
      response.status(422);
      return validationResponse(requestId, "通知查询参数无效");
    }
    try {
      const result = await this.queryService.query({
        actorUserId: actor.userId,
        ...(parsed.data.cursor === undefined
          ? {}
          : { after: parsed.data.cursor }),
        ...(parsed.data.limit === undefined
          ? {}
          : { limit: parsed.data.limit }),
        ...(parsed.data.unreadOnly === undefined
          ? {}
          : { unreadOnly: parsed.data.unreadOnly }),
      });
      return {
        items: result.items,
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
      };
    } catch (error) {
      if (error instanceof NotificationQueryValidationError) {
        response.status(422);
        return validationResponse(requestId, error.message);
      }
      response.status(500);
      return internalError(requestId);
    }
  }

  @Get("unread-count")
  async unreadCount(
    @Req() request: NotificationControllerRequest,
    @Res({ passthrough: true }) response: NotificationControllerResponse,
  ): Promise<unknown | ErrorResponseDto> {
    const requestId = randomUUID();
    const actor = await this.sessionAuth.resolveActor(
      getHeader(request.headers, "cookie"),
    );
    if (actor === undefined) {
      return unauthorized(requestId, response);
    }
    try {
      return { unreadCount: await this.queryService.unreadCount(actor.userId) };
    } catch {
      response.status(500);
      return internalError(requestId);
    }
  }

  @Post(":notificationId/read")
  @HttpCode(204)
  async read(
    @Req() request: NotificationControllerRequest,
    @Res({ passthrough: true }) response: NotificationControllerResponse,
    @Param() params: unknown,
  ): Promise<ErrorResponseDto | undefined> {
    return this.runNotificationMutation(
      "readNotification",
      "/notifications/{notificationId}/read",
      request,
      response,
      params,
      async (tx, actorId, notificationId) => {
        await this.stateService.markRead(tx, {
          recipientId: actorId,
          notificationId,
        });
        return { notificationId, recipientId: actorId };
      },
    );
  }

  @Post(":notificationId/unread")
  @HttpCode(204)
  async unread(
    @Req() request: NotificationControllerRequest,
    @Res({ passthrough: true }) response: NotificationControllerResponse,
    @Param() params: unknown,
  ): Promise<ErrorResponseDto | undefined> {
    return this.runNotificationMutation(
      "unreadNotification",
      "/notifications/{notificationId}/unread",
      request,
      response,
      params,
      async (tx, actorId, notificationId) => {
        await this.stateService.markUnread(tx, {
          recipientId: actorId,
          notificationId,
        });
        return { notificationId, recipientId: actorId };
      },
    );
  }

  @Post("read-all")
  @HttpCode(204)
  async readAll(
    @Req() request: NotificationControllerRequest,
    @Res({ passthrough: true }) response: NotificationControllerResponse,
  ): Promise<ErrorResponseDto | undefined> {
    const requestId = randomUUID();
    const originFailure = mutationSameOriginValidationError(request.headers);
    if (originFailure !== undefined) {
      return csrfOriginFailure(requestId, response, originFailure);
    }
    try {
      const result = await this.idempotency.run({
        operationId: "readAllNotifications",
        actorId: async (tx) => this.resolveMutationActor(tx, request),
        request: {
          method: "POST",
          path: "/notifications/read-all",
          pathParams: {},
          query: {},
          headers: request.headers,
          body: undefined,
        },
        execute: async (tx, actorId) => {
          await this.stateService.readAll(tx, actorId);
          return noBodyResult({});
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

  private async runNotificationMutation(
    operationId: "readNotification" | "unreadNotification",
    routePath: string,
    request: NotificationControllerRequest,
    response: NotificationControllerResponse,
    params: unknown,
    execute: (
      tx: TransactionContext,
      actorId: number,
      notificationId: number,
    ) => Promise<{
      readonly notificationId: number;
      readonly recipientId: number;
    }>,
  ): Promise<ErrorResponseDto | undefined> {
    const requestId = randomUUID();
    const originFailure = mutationSameOriginValidationError(request.headers);
    if (originFailure !== undefined) {
      return csrfOriginFailure(requestId, response, originFailure);
    }
    const parsedPath = notificationPathSchema.safeParse(params);
    if (!parsedPath.success) {
      response.status(422);
      return validationResponse(requestId, "通知 ID 无效");
    }
    try {
      const result = await this.idempotency.run({
        operationId,
        actorId: async (tx) => this.resolveMutationActor(tx, request),
        request: {
          method: "POST",
          path: routePath,
          pathParams: {
            notificationId: String(parsedPath.data.notificationId),
          },
          query: {},
          headers: request.headers,
          body: undefined,
        },
        execute: async (tx, actorId) => {
          const context = await execute(
            tx,
            actorId,
            parsedPath.data.notificationId,
          );
          return noBodyResult(context);
        },
        replayAuthorizer: async (_record, tx) => {
          const actor = await this.resolveMutationActor(tx, request);
          await this.stateService.assertOwned(
            tx,
            actor,
            parsedPath.data.notificationId,
          );
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
    request: NotificationControllerRequest,
  ): Promise<number> {
    const actor = await this.mutationAuth.verify(tx, request.headers);
    if (actor === undefined) {
      throw new NotificationAuthError();
    }
    return actor.userId;
  }

  private mapMutationError(
    error: unknown,
    requestId: string,
    response: NotificationControllerResponse,
  ): ErrorResponseDto {
    if (error instanceof NotificationAuthError) {
      response.status(401);
      return {
        code: error.code,
        message: "需要有效认证 Session 与 CSRF Token",
        details: {},
        requestId,
      };
    }
    if (error instanceof NotificationNotFoundError) {
      response.status(404);
      return {
        code: error.code,
        message: "通知不存在或不属于当前用户",
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

function noBodyResult(replayAuthContext: Record<string, unknown>) {
  return {
    responseStatus: 204,
    responseSchemaRef: null,
    responseHasBody: false,
    responseBody: null,
    replayAuthContext,
  };
}

function unauthorized(
  requestId: string,
  response: NotificationControllerResponse,
): ErrorResponseDto {
  response.status(401);
  return {
    code: "NOTIFICATION_UNAUTHENTICATED",
    message: "需要有效认证 Session 才能查看通知",
    details: {},
    requestId,
  };
}

function validationResponse(
  requestId: string,
  message: string,
): ErrorResponseDto {
  return {
    code: "NOTIFICATION_VALIDATION_FAILED",
    message,
    details: {},
    requestId,
  };
}

function csrfOriginFailure(
  requestId: string,
  response: NotificationControllerResponse,
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
    message: "服务器无法完成通知操作",
    details: {},
    requestId,
  };
}
