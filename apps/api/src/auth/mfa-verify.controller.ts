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
import type { VerifyMfaHeaders, VerifyMfaRequest } from "@inpulse/api-contract";
import {
  getHeader,
  mutationSameOriginValidationError,
  type HttpHeaderBag,
} from "./csrf.http.js";
import { StrictSameOriginGuard } from "./csrf.guard.js";
import { normalizeClientIp } from "./auth-rate-limit.policy.js";
import { MfaRateLimitError } from "./mfa-rate-limit.error.js";
import { MfaVerifyError } from "./mfa-verify.error.js";
import { MfaVerifyService } from "./mfa-verify.service.js";

interface MfaVerifyRequest {
  readonly headers: HttpHeaderBag;
  readonly body: unknown;
  readonly ip?: string;
  readonly socket?: { readonly remoteAddress?: string };
}

interface MfaVerifyResponse {
  status(code: number): unknown;
  setHeader(name: string, value: string | readonly string[]): unknown;
}

interface ErrorResponseDto {
  readonly code: string;
  readonly message: string;
  readonly details: Readonly<Record<string, string>>;
  readonly requestId: string;
}

interface VerifyResponseDto {
  readonly csrfToken: string;
  readonly authState: "AUTHENTICATED";
}

function resolveClientIp(request: MfaVerifyRequest): string {
  const raw =
    request.ip?.trim() || request.socket?.remoteAddress?.trim() || "unknown";
  return normalizeClientIp(raw);
}

/** ADR-023 安全流程入口：POST /auth/mfa/verify 完成 TOTP 验证并升级当前 Session。 */
@Controller("auth/mfa")
export class MfaVerifyController {
  constructor(private readonly service: MfaVerifyService) {}

  @Post("verify")
  @HttpCode(200)
  @UseGuards(StrictSameOriginGuard)
  @Operation("verifyMfa")
  async verify(
    @Req() request: MfaVerifyRequest,
    @Res({ passthrough: true }) response: MfaVerifyResponse,
    @ContractBody("verifyMfa") body: VerifyMfaRequest,
    @ContractHeaders("verifyMfa") headers: VerifyMfaHeaders,
  ): Promise<VerifyResponseDto | ErrorResponseDto> {
    const requestId = randomUUID();
    const originFailure = mutationSameOriginValidationError(request.headers);
    if (originFailure !== undefined) {
      response.status(403);
      return {
        code: "CSRF_ORIGIN_REJECTED",
        message: "MFA 验证请求未通过同源或 Fetch Metadata 校验",
        details: { reason: originFailure },
        requestId,
      };
    }
    try {
      const result = await this.service.verify({
        code: body.code,
        clientIp: resolveClientIp(request),
        cookieHeader: getHeader(request.headers, "cookie"),
        csrfToken: headers["x-csrf-token"],
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
    response: MfaVerifyResponse,
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
    if (error instanceof MfaVerifyError) {
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
      message: "服务器无法完成 MFA 验证",
      details: {},
      requestId,
    };
  }
}
