import { randomUUID } from "node:crypto";

import { Controller, Post, Req, Res, UseGuards } from "@nestjs/common";

import {
  ContractBody,
  ContractHeaders,
  Operation,
} from "../http/contract.decorators.js";
import type {
  ReauthenticateAdminHeaders,
  ReauthenticateAdminRequest,
} from "@inpulse/api-contract";
import {
  getHeader,
  mutationSameOriginValidationError,
  type HttpHeaderBag,
} from "./csrf.http.js";
import { StrictSameOriginGuard } from "./csrf.guard.js";
import { normalizeClientIp } from "./auth-rate-limit.policy.js";
import { LoginError } from "./login.error.js";
import { MfaRateLimitError } from "./mfa-rate-limit.error.js";
import { MfaReauthenticateError } from "./mfa-reauthenticate.error.js";
import { MfaReauthenticateService } from "./mfa-reauthenticate.service.js";

interface MfaReauthenticateRequest {
  readonly headers: HttpHeaderBag;
  readonly body: unknown;
  readonly ip?: string;
  readonly socket?: { readonly remoteAddress?: string };
}

interface MfaReauthenticateResponse {
  status(code: number): unknown;
  setHeader(name: string, value: string | readonly string[]): unknown;
}

interface ErrorResponseDto {
  readonly code: string;
  readonly message: string;
  readonly details: Readonly<Record<string, string>>;
  readonly requestId: string;
}

function resolveClientIp(request: MfaReauthenticateRequest): string {
  const raw =
    request.ip?.trim() || request.socket?.remoteAddress?.trim() || "unknown";
  return normalizeClientIp(raw);
}

/** ADR-023 安全流程入口：POST /auth/mfa/reauthenticate 刷新管理员重认证时效。 */
@Controller("auth/mfa")
export class MfaReauthenticateController {
  constructor(private readonly service: MfaReauthenticateService) {}

  @Post("reauthenticate")
  @UseGuards(StrictSameOriginGuard)
  @Operation("reauthenticateAdmin")
  async reauthenticate(
    @Req() request: MfaReauthenticateRequest,
    @Res({ passthrough: true }) response: MfaReauthenticateResponse,
    @ContractBody("reauthenticateAdmin") body: ReauthenticateAdminRequest,
    @ContractHeaders("reauthenticateAdmin") headers: ReauthenticateAdminHeaders,
  ): Promise<void | ErrorResponseDto> {
    const requestId = randomUUID();
    const originFailure = mutationSameOriginValidationError(request.headers);
    if (originFailure !== undefined) {
      response.status(403);
      return {
        code: "CSRF_ORIGIN_REJECTED",
        message: "管理员重认证请求未通过同源或 Fetch Metadata 校验",
        details: { reason: originFailure },
        requestId,
      };
    }

    try {
      await this.service.reauthenticate({
        password: body.password,
        code: body.code,
        clientIp: resolveClientIp(request),
        cookieHeader: getHeader(request.headers, "cookie"),
        csrfToken: headers["x-csrf-token"],
      });
      response.status(204);
      response.setHeader("Cache-Control", "no-store");
      return undefined;
    } catch (error) {
      return this.mapError(error, response, requestId);
    }
  }

  private mapError(
    error: unknown,
    response: MfaReauthenticateResponse,
    requestId: string,
  ): ErrorResponseDto {
    if (error instanceof MfaReauthenticateError) {
      response.status(error.status);
      return {
        code: error.code,
        message: error.message,
        details: { reason: error.reason },
        requestId,
      };
    }
    if (error instanceof MfaRateLimitError || error instanceof LoginError) {
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
      message: "服务器无法完成管理员重认证",
      details: {},
      requestId,
    };
  }
}
