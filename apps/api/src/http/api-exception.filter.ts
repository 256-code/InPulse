import { randomUUID } from "node:crypto";

import {
  Catch,
  HttpException,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";

import {
  ApiHttpError,
  ContractResponseError,
  ContractValidationError,
} from "./contract-errors.js";

interface ErrorResponseBody {
  readonly code: string;
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly requestId: string;
}

interface HttpResponse {
  status(code: number): HttpResponse;
  setHeader(name: string, value: string): unknown;
  json(body: ErrorResponseBody): unknown;
}

/**
 * 把契约校验和未预期异常统一转换为 ErrorResponse，禁止 NestJS 默认
 * 错误格式或堆栈/内部校验细节返回客户端。
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<HttpResponse>();
    const body = this.toErrorResponse(exception);
    response.setHeader("X-Request-Id", body.body.requestId);
    response.status(body.status).json(body.body);
  }

  private toErrorResponse(exception: unknown): {
    readonly status: number;
    readonly body: ErrorResponseBody;
  } {
    const requestId = randomUUID();
    if (exception instanceof ContractValidationError) {
      return {
        status: exception.statusCode,
        body: {
          code: "VALIDATION_FAILED",
          message: "请求字段校验失败",
          details: {
            issues: exception.issues
              .map((issue) => `${issue.path}: ${issue.message}`)
              .join("; "),
          },
          requestId,
        },
      };
    }

    if (exception instanceof ApiHttpError) {
      return {
        status: exception.statusCode,
        body: {
          code: exception.code,
          message: exception.message,
          details: exception.details,
          requestId,
        },
      };
    }

    if (exception instanceof HttpException) {
      return this.toHttpExceptionResponse(exception, requestId);
    }

    this.logger.error(
      exception instanceof Error
        ? exception.message
        : `unexpected non-Error exception: ${String(exception)}`,
    );
    if (exception instanceof ContractResponseError) {
      return {
        status: exception.statusCode,
        body: {
          code: "INTERNAL_ERROR",
          message: "服务器无法完成响应契约校验",
          details: {},
          requestId,
        },
      };
    }
    return {
      status: 500,
      body: {
        code: "INTERNAL_ERROR",
        message: "服务器内部错误",
        details: {},
        requestId,
      },
    };
  }

  private toHttpExceptionResponse(
    exception: HttpException,
    requestId: string,
  ): {
    readonly status: number;
    readonly body: ErrorResponseBody;
  } {
    const status = exception.getStatus();
    const mapping: Readonly<
      Record<number, { readonly code: string; readonly message: string }>
    > = {
      400: { code: "BAD_REQUEST", message: "请求参数格式无效" },
      401: { code: "UNAUTHENTICATED", message: "认证状态无效或已过期" },
      403: { code: "FORBIDDEN", message: "当前身份无权执行该操作" },
      404: { code: "NOT_FOUND", message: "请求的资源不存在" },
      409: { code: "CONFLICT", message: "请求与当前资源状态冲突" },
      422: { code: "VALIDATION_FAILED", message: "请求字段校验失败" },
      429: { code: "RATE_LIMITED", message: "请求过于频繁，请稍后再试" },
      503: { code: "SERVICE_UNAVAILABLE", message: "服务暂时不可用" },
    };
    const mapped = mapping[status] ?? {
      code: "HTTP_ERROR",
      message: "请求处理失败",
    };
    return {
      status,
      body: {
        code: mapped.code,
        message: mapped.message,
        details: {},
        requestId,
      },
    };
  }
}
