import { randomUUID } from "node:crypto";

import { Controller, Get, Req, Res } from "@nestjs/common";

import type { AuditLogPage, AuditLogQueryRequest } from "@inpulse/api-contract";
import { AdminHighRiskAuthService } from "../auth/admin-high-risk.service.js";
import { AdminHighRiskError } from "../auth/admin-high-risk.error.js";
import { normalizeClientIp } from "../auth/auth-rate-limit.policy.js";
import { getHeader, type HttpHeaderBag } from "../auth/csrf.http.js";
import { PostgresUnitOfWork } from "../database/unit-of-work.js";
import { ContractQuery, Operation } from "../http/contract.decorators.js";
import {
  AuditQueryService,
  AuditQueryValidationError,
} from "./audit-query.service.js";

interface AuditLogControllerRequest {
  readonly headers: HttpHeaderBag;
  readonly ip?: string;
  readonly socket?: { readonly remoteAddress?: string };
}

interface AuditLogControllerResponse {
  status(code: number): unknown;
}

interface ErrorResponseDto {
  readonly code: string;
  readonly message: string;
  readonly details: Readonly<Record<string, string>>;
  readonly requestId: string;
}

const CLIENT_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

/** 客户端可选 `X-Request-Id`：格式不符时不接受（保存为 null），不报错。 */
function clientRequestIdFrom(headers: HttpHeaderBag): string | null {
  const value = getHeader(headers, "x-request-id")?.trim();
  if (value === undefined || !CLIENT_REQUEST_ID_PATTERN.test(value)) {
    return null;
  }
  return value;
}

function resolveClientIp(request: AuditLogControllerRequest): string | null {
  const raw = request.ip?.trim() || request.socket?.remoteAddress?.trim() || "";
  const normalized = normalizeClientIp(raw);
  return normalized === "unknown" ? null : normalized;
}

function resolveUserAgent(headers: HttpHeaderBag): string | null {
  const value = getHeader(headers, "user-agent")?.trim();
  if (value === undefined || value.length === 0) {
    return null;
  }
  return value.slice(0, 1000);
}

/**
 * F-08 原始审计读取入口：只绑定 Route Registry 中的 getAuditLogs。
 * 先要求完整管理员 Session 且密码 + 当前 TOTP 重认证在 5 分钟内
 * （GET 只读路径不强制同步 CSRF），再由 AuditQueryService 用独立
 * `audit_reader` 连接查询；返回前向 SYSTEM 链写 AUDIT_LOG_READ，
 * 留痕失败整体失败、不返回未留痕结果。
 */
@Controller("audit-logs")
export class AuditLogController {
  constructor(
    private readonly highRisk: AdminHighRiskAuthService,
    private readonly unitOfWork: PostgresUnitOfWork,
    private readonly auditQuery: AuditQueryService,
  ) {}

  @Get()
  @Operation("getAuditLogs")
  async list(
    @Req() request: AuditLogControllerRequest,
    @Res({ passthrough: true }) response: AuditLogControllerResponse,
    @ContractQuery("getAuditLogs") query: AuditLogQueryRequest,
  ): Promise<AuditLogPage | ErrorResponseDto> {
    const requestId = randomUUID();

    let actorUserId: number;
    try {
      const actor = await this.unitOfWork.run((tx) =>
        this.highRisk.verifyRead(tx, request.headers),
      );
      actorUserId = actor.userId;
    } catch (error) {
      if (error instanceof AdminHighRiskError) {
        response.status(error.status);
        return {
          code: error.code,
          message: error.message,
          details: { reason: error.reason },
          requestId,
        };
      }
      throw error;
    }

    try {
      const result = await this.auditQuery.query(
        { actorUserId, query },
        {
          requestId,
          clientRequestId: clientRequestIdFrom(request.headers),
          ipAddress: resolveClientIp(request),
          userAgent: resolveUserAgent(request.headers),
        },
      );
      return {
        items: [...result.items],
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
      };
    } catch (error) {
      if (error instanceof AuditQueryValidationError) {
        response.status(422);
        return {
          code: "VALIDATION_FAILED",
          message: error.message,
          details: { reason: error.reason },
          requestId,
        };
      }
      response.status(500);
      return {
        code: "INTERNAL_ERROR",
        message: "服务器无法完成原始审计读取",
        details: {},
        requestId,
      };
    }
  }
}
