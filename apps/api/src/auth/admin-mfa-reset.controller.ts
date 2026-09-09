import { randomUUID } from "node:crypto";

import type {
  ResetAdminMfaHeaders,
  ResetAdminMfaRequest,
} from "@inpulse/api-contract";
import {
  Controller,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";

import {
  ContractBody,
  ContractHeaders,
  Operation,
} from "../http/contract.decorators.js";
import { AdminHighRiskError } from "./admin-high-risk.error.js";
import { AdminHighRiskAuthService } from "./admin-high-risk.service.js";
import { AdminMfaResetError } from "./admin-mfa-reset.error.js";
import { AdminMfaResetService } from "./admin-mfa-reset.service.js";
import { AuthenticatedMutationService } from "./authenticated-mutation.service.js";
import {
  mutationSameOriginValidationError,
  type HttpHeaderBag,
} from "./csrf.http.js";
import { StrictSameOriginGuard } from "./csrf.guard.js";
import {
  IdempotencyHttpError,
  IdempotencyHttpService,
} from "../idempotency/http-service.js";
import type { TransactionContext } from "../database/transaction-context.js";

interface AdminMfaResetControllerRequest {
  readonly headers: HttpHeaderBag;
  readonly body: unknown;
}

interface AdminMfaResetControllerResponse {
  status(code: number): unknown;
}

interface ErrorResponseDto {
  readonly code: string;
  readonly message: string;
  readonly details: Readonly<Record<string, string>>;
  readonly requestId: string;
}

class AdminMfaResetAuthError extends Error {
  readonly code = "ADMIN_MFA_RESET_UNAUTHENTICATED" as const;

  constructor() {
    super(
      "current admin session, CSRF token or recent reauthentication is invalid",
    );
    this.name = "AdminMfaResetAuthError";
  }
}

/** F-02.5 管理员 MFA 重置入口；幂等由 IdempotencyHttpService 承担。 */
@Controller("auth/admin")
export class AdminMfaResetController {
  constructor(
    private readonly mutationAuth: AuthenticatedMutationService,
    private readonly adminHighRisk: AdminHighRiskAuthService,
    private readonly idempotency: IdempotencyHttpService,
    private readonly resetService: AdminMfaResetService,
  ) {}

  @Post("mfa-reset")
  @HttpCode(204)
  @UseGuards(StrictSameOriginGuard)
  @Operation("resetAdminMfa")
  async reset(
    @Req() request: AdminMfaResetControllerRequest,
    @Res({ passthrough: true }) response: AdminMfaResetControllerResponse,
    @ContractBody("resetAdminMfa") body: ResetAdminMfaRequest,
    @ContractHeaders("resetAdminMfa") headers: ResetAdminMfaHeaders,
  ): Promise<ErrorResponseDto | undefined> {
    const requestId = randomUUID();
    const originFailure = mutationSameOriginValidationError(request.headers);
    if (originFailure !== undefined) {
      response.status(403);
      return {
        code: "CSRF_ORIGIN_REJECTED",
        message: "管理员 MFA 重置请求未通过同源或 Fetch Metadata 校验",
        details: { reason: originFailure },
        requestId,
      };
    }
    void headers;

    try {
      const result = await this.idempotency.run({
        operationId: "resetAdminMfa",
        actorId: async (tx) => this.resolveActor(tx, request),
        request: {
          method: "POST",
          path: "/auth/admin/mfa-reset",
          pathParams: {},
          query: {},
          headers: request.headers,
          body: request.body,
        },
        execute: async (tx, actorId) => {
          await this.resetService.execute(tx, actorId, {
            userId: body.userId,
            reason: body.reason,
            requestId,
            headers: request.headers,
          });
          return noBodyResult({ actorUserId: actorId });
        },
        replayAuthorizer: async (record, tx) => {
          const actor = await this.adminHighRisk.verify(tx, request.headers);
          if (actor.userId !== record.actorId) {
            throw new AdminMfaResetAuthError();
          }
        },
      });
      response.status(result.responseStatus);
      return undefined;
    } catch (error) {
      return this.mapError(error, requestId, response);
    }
  }

  private async resolveActor(
    tx: TransactionContext,
    request: AdminMfaResetControllerRequest,
  ): Promise<number> {
    const actor = await this.mutationAuth.verify(tx, request.headers);
    if (actor === undefined) {
      throw new AdminMfaResetAuthError();
    }
    return actor.userId;
  }

  private mapError(
    error: unknown,
    requestId: string,
    response: AdminMfaResetControllerResponse,
  ): ErrorResponseDto {
    if (error instanceof AdminMfaResetAuthError) {
      response.status(401);
      return {
        code: error.code,
        message: "需要有效管理员 Session、CSRF 与 5 分钟内双重认证",
        details: {},
        requestId,
      };
    }
    if (
      error instanceof AdminMfaResetError ||
      error instanceof AdminHighRiskError
    ) {
      response.status(error.status);
      return {
        code: error.code,
        message: error.message,
        details: { reason: error.reason },
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
      message: "服务器无法完成管理员 MFA 重置",
      details: {},
      requestId,
    };
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
