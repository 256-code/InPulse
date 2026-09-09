import { randomUUID } from "node:crypto";

import { Body, Controller, Post, Req, Res } from "@nestjs/common";

import {
  getHeader,
  mutationSameOriginValidationError,
  type HttpHeaderBag,
} from "./csrf.http.js";
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

interface ReauthenticateRequest {
  readonly password: string;
  readonly code: string;
}

function parseReauthenticateBody(
  body: unknown,
): ReauthenticateRequest | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return undefined;
  }
  const record = body as Readonly<Record<string, unknown>>;
  const password = record["password"];
  const code = record["code"];
  if (
    typeof password !== "string" ||
    password.length < 1 ||
    password.length > 1024 ||
    typeof code !== "string" ||
    !/^\d{6}$/.test(code)
  ) {
    return undefined;
  }
  return { password, code };
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
  async reauthenticate(
    @Req() request: MfaReauthenticateRequest,
    @Res({ passthrough: true }) response: MfaReauthenticateResponse,
    @Body() body: unknown,
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

    const parsed = parseReauthenticateBody(body);
    if (parsed === undefined) {
      response.status(422);
      return {
        code: "REAUTH_VALIDATION_FAILED",
        message: "管理员重认证请求体格式或字段长度无效",
        details: {},
        requestId,
      };
    }

    try {
      await this.service.reauthenticate({
        password: parsed.password,
        code: parsed.code,
        clientIp: resolveClientIp(request),
        cookieHeader: getHeader(request.headers, "cookie"),
        csrfToken: getHeader(request.headers, "x-csrf-token"),
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
