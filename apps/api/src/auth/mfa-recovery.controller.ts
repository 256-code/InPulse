import { randomUUID } from "node:crypto";

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
import type {
  ConsumeMfaRecoveryCodeHeaders,
  ConsumeMfaRecoveryCodeRequest,
  RotateMfaRecoveryCodesHeaders,
} from "@inpulse/api-contract";
import { normalizeClientIp } from "./auth-rate-limit.policy.js";
import { AdminHighRiskError } from "./admin-high-risk.error.js";
import {
  getHeader,
  mutationSameOriginValidationError,
  type HttpHeaderBag,
} from "./csrf.http.js";
import { StrictSameOriginGuard } from "./csrf.guard.js";
import { MfaRateLimitError } from "./mfa-rate-limit.error.js";
import { MfaRecoveryError } from "./mfa-recovery.error.js";
import { MfaRecoveryService } from "./mfa-recovery.service.js";

interface MfaRecoveryRequest {
  readonly headers: HttpHeaderBag;
  readonly body: unknown;
  readonly ip?: string;
  readonly socket?: { readonly remoteAddress?: string };
}

interface MfaRecoveryResponse {
  status(code: number): unknown;
  setHeader(name: string, value: string | readonly string[]): unknown;
}

interface ErrorResponseDto {
  readonly code: string;
  readonly message: string;
  readonly details: Readonly<Record<string, string>>;
  readonly requestId: string;
}

interface RotateResponseDto {
  readonly recoveryCodes: readonly string[];
}

interface ConsumeResponseDto {
  readonly csrfToken: string;
  readonly authState: "AUTHENTICATED";
}

function resolveClientIp(request: MfaRecoveryRequest): string {
  const raw =
    request.ip?.trim() || request.socket?.remoteAddress?.trim() || "unknown";
  return normalizeClientIp(raw);
}

/** ADR-023 安全流程入口：恢复码轮换与恢复码消费。 */
@Controller("auth/mfa/recovery-codes")
export class MfaRecoveryController {
  constructor(private readonly service: MfaRecoveryService) {}

  @Post("rotate")
  @HttpCode(200)
  @UseGuards(StrictSameOriginGuard)
  @Operation("rotateMfaRecoveryCodes")
  async rotate(
    @Req() request: MfaRecoveryRequest,
    @Res({ passthrough: true }) response: MfaRecoveryResponse,
    @ContractHeaders("rotateMfaRecoveryCodes")
    headers: RotateMfaRecoveryCodesHeaders,
  ): Promise<RotateResponseDto | ErrorResponseDto> {
    const requestId = randomUUID();
    const originFailure = mutationSameOriginValidationError(request.headers);
    if (originFailure !== undefined) {
      response.status(403);
      return {
        code: "CSRF_ORIGIN_REJECTED",
        message: "恢复码轮换请求未通过同源或 Fetch Metadata 校验",
        details: { reason: originFailure },
        requestId,
      };
    }
    try {
      const result = await this.service.rotate({
        cookieHeader: getHeader(request.headers, "cookie"),
        csrfToken: headers["x-csrf-token"],
        requestId,
      });
      response.setHeader("Cache-Control", "no-store");
      response.status(200);
      return { recoveryCodes: result.recoveryCodes };
    } catch (error) {
      return this.mapError(error, response, requestId);
    }
  }

  @Post("consume")
  @HttpCode(200)
  @UseGuards(StrictSameOriginGuard)
  @Operation("consumeMfaRecoveryCode")
  async consume(
    @Req() request: MfaRecoveryRequest,
    @Res({ passthrough: true }) response: MfaRecoveryResponse,
    @ContractBody("consumeMfaRecoveryCode") body: ConsumeMfaRecoveryCodeRequest,
    @ContractHeaders("consumeMfaRecoveryCode")
    headers: ConsumeMfaRecoveryCodeHeaders,
  ): Promise<ConsumeResponseDto | ErrorResponseDto> {
    const requestId = randomUUID();
    const originFailure = mutationSameOriginValidationError(request.headers);
    if (originFailure !== undefined) {
      response.status(403);
      return {
        code: "CSRF_ORIGIN_REJECTED",
        message: "恢复码消费请求未通过同源或 Fetch Metadata 校验",
        details: { reason: originFailure },
        requestId,
      };
    }
    try {
      const result = await this.service.consume({
        code: body.code,
        clientIp: resolveClientIp(request),
        cookieHeader: getHeader(request.headers, "cookie"),
        csrfToken: headers["x-csrf-token"],
        requestId,
      });
      response.setHeader("Cache-Control", "no-store");
      response.status(200);
      return {
        csrfToken: result.csrfToken,
        authState: result.authState,
      };
    } catch (error) {
      return this.mapError(error, response, requestId);
    }
  }

  private mapError(
    error: unknown,
    response: MfaRecoveryResponse,
    requestId: string,
  ): ErrorResponseDto {
    if (error instanceof MfaRateLimitError) {
      response.status(error.status);
      return {
        code: error.code,
        message: error.message,
        details: { reason: error.reason },
        requestId,
      };
    }
    if (
      error instanceof MfaRecoveryError ||
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
    response.status(500);
    return {
      code: "INTERNAL_ERROR",
      message: "服务器无法完成恢复码操作",
      details: {},
      requestId,
    };
  }
}
