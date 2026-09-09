import { randomUUID } from "node:crypto";

import { Body, Controller, HttpCode, Post, Req, Res } from "@nestjs/common";

import {
  getHeader,
  mutationSameOriginValidationError,
  type HttpHeaderBag,
} from "./csrf.http.js";
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

interface VerifyRequest {
  readonly code: string;
}

interface VerifyResponseDto {
  readonly csrfToken: string;
  readonly authState: "AUTHENTICATED";
}

function parseVerifyBody(body: unknown): VerifyRequest | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return undefined;
  }
  const record = body as Readonly<Record<string, unknown>>;
  const code = record["code"];
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
    return undefined;
  }
  return { code };
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
  async verify(
    @Req() request: MfaVerifyRequest,
    @Res({ passthrough: true }) response: MfaVerifyResponse,
    @Body() body: unknown,
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
    const parsed = parseVerifyBody(body);
    if (parsed === undefined) {
      response.status(422);
      return {
        code: "MFA_VERIFY_VALIDATION_FAILED",
        message: "MFA 验证请求体格式或字段长度无效",
        details: {},
        requestId,
      };
    }

    try {
      const result = await this.service.verify({
        code: parsed.code,
        clientIp: resolveClientIp(request),
        cookieHeader: getHeader(request.headers, "cookie"),
        csrfToken: getHeader(request.headers, "x-csrf-token"),
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
