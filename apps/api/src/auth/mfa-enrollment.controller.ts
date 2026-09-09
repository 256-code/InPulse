import { randomUUID } from "node:crypto";

import { Body, Controller, HttpCode, Post, Req, Res } from "@nestjs/common";

import {
  buildCookie,
  getHeader,
  mutationSameOriginValidationError,
  type HttpHeaderBag,
} from "./csrf.http.js";
import { normalizeClientIp } from "./auth-rate-limit.policy.js";
import { MfaEnrollmentService } from "./mfa-enrollment.service.js";
import { MfaEnrollmentError } from "./mfa-enrollment.error.js";
import { MfaRateLimitError } from "./mfa-rate-limit.error.js";

interface MfaEnrollmentRequest {
  readonly headers: HttpHeaderBag;
  readonly body: unknown;
  readonly ip?: string;
  readonly socket?: { readonly remoteAddress?: string };
}

interface MfaEnrollmentResponse {
  status(code: number): unknown;
  setHeader(name: string, value: string | readonly string[]): unknown;
}

interface ErrorResponseDto {
  readonly code: string;
  readonly message: string;
  readonly details: Readonly<Record<string, string>>;
  readonly requestId: string;
}

interface StartRequest {
  readonly expectedEnrollmentGeneration: number;
}

interface ConfirmRequest {
  readonly expectedEnrollmentGeneration: number;
  readonly code: string;
}

interface StartResponseDto {
  readonly enrollmentGeneration: number;
  readonly secret: string;
  readonly otpauthUri: string;
}

interface ConfirmResponseDto {
  readonly csrfToken: string;
  readonly authState: "AUTHENTICATED";
  readonly recoveryCodes: readonly string[];
}

function parseStartBody(body: unknown): StartRequest | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return undefined;
  }
  const record = body as Readonly<Record<string, unknown>>;
  const expected = record["expectedEnrollmentGeneration"];
  if (
    typeof expected !== "number" ||
    !Number.isInteger(expected) ||
    expected < 0 ||
    expected > 1_000_000
  ) {
    return undefined;
  }
  return { expectedEnrollmentGeneration: expected };
}

function parseConfirmBody(body: unknown): ConfirmRequest | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return undefined;
  }
  const record = body as Readonly<Record<string, unknown>>;
  const expected = record["expectedEnrollmentGeneration"];
  const code = record["code"];
  if (
    typeof expected !== "number" ||
    !Number.isInteger(expected) ||
    expected < 0 ||
    expected > 1_000_000 ||
    typeof code !== "string" ||
    !/^\d{6}$/.test(code)
  ) {
    return undefined;
  }
  return { expectedEnrollmentGeneration: expected, code };
}

function resolveClientIp(request: MfaEnrollmentRequest): string {
  const raw =
    request.ip?.trim() || request.socket?.remoteAddress?.trim() || "unknown";
  return normalizeClientIp(raw);
}

@Controller("auth/mfa/enrollment")
export class MfaEnrollmentController {
  constructor(private readonly service: MfaEnrollmentService) {}

  @Post("start")
  @HttpCode(200)
  async start(
    @Req() request: MfaEnrollmentRequest,
    @Res({ passthrough: true }) response: MfaEnrollmentResponse,
    @Body() body: unknown,
  ): Promise<StartResponseDto | ErrorResponseDto> {
    const requestId = randomUUID();
    const originFailure = mutationSameOriginValidationError(request.headers);
    if (originFailure !== undefined) {
      response.status(403);
      return {
        code: "CSRF_ORIGIN_REJECTED",
        message: "MFA 注册请求未通过同源或 Fetch Metadata 校验",
        details: { reason: originFailure },
        requestId,
      };
    }
    const parsed = parseStartBody(body);
    if (parsed === undefined) {
      response.status(422);
      return {
        code: "MFA_ENROLLMENT_VALIDATION_FAILED",
        message: "MFA 注册请求体格式或字段长度无效",
        details: {},
        requestId,
      };
    }
    try {
      const result = await this.service.start({
        expectedEnrollmentGeneration: parsed.expectedEnrollmentGeneration,
        cookieHeader: getHeader(request.headers, "cookie"),
        csrfToken: getHeader(request.headers, "x-csrf-token"),
      });
      response.setHeader("Cache-Control", "no-store");
      response.status(200);
      return {
        enrollmentGeneration: result.enrollmentGeneration,
        secret: result.secret,
        otpauthUri: result.otpauthUri,
      };
    } catch (error) {
      return this.mapError(error, response, requestId);
    }
  }

  @Post("confirm")
  @HttpCode(200)
  async confirm(
    @Req() request: MfaEnrollmentRequest,
    @Res({ passthrough: true }) response: MfaEnrollmentResponse,
    @Body() body: unknown,
  ): Promise<ConfirmResponseDto | ErrorResponseDto> {
    const requestId = randomUUID();
    const originFailure = mutationSameOriginValidationError(request.headers);
    if (originFailure !== undefined) {
      response.status(403);
      return {
        code: "CSRF_ORIGIN_REJECTED",
        message: "MFA 注册确认请求未通过同源或 Fetch Metadata 校验",
        details: { reason: originFailure },
        requestId,
      };
    }
    const parsed = parseConfirmBody(body);
    if (parsed === undefined) {
      response.status(422);
      return {
        code: "MFA_ENROLLMENT_VALIDATION_FAILED",
        message: "MFA 注册确认请求体格式或字段长度无效",
        details: {},
        requestId,
      };
    }
    try {
      const result = await this.service.confirm({
        expectedEnrollmentGeneration: parsed.expectedEnrollmentGeneration,
        code: parsed.code,
        clientIp: resolveClientIp(request),
        cookieHeader: getHeader(request.headers, "cookie"),
        csrfToken: getHeader(request.headers, "x-csrf-token"),
      });
      response.setHeader(
        "Set-Cookie",
        result.cookies.map((cookie) => buildCookie(cookie)),
      );
      response.setHeader("Cache-Control", "no-store");
      response.status(200);
      return {
        csrfToken: result.csrfToken,
        authState: result.authState,
        recoveryCodes: result.recoveryCodes,
      };
    } catch (error) {
      return this.mapError(error, response, requestId);
    }
  }

  private mapError(
    error: unknown,
    response: MfaEnrollmentResponse,
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
    if (error instanceof MfaEnrollmentError) {
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
      message: "服务器无法完成 MFA 注册",
      details: {},
      requestId,
    };
  }
}
