import { AsyncLocalStorage } from "node:async_hooks";
import { isIP } from "node:net";

import { getHeader, type HttpHeaderBag } from "../auth/csrf.http.js";
import type { AuditWriteInput } from "./audit.port.js";

/**
 * 请求级审计元数据（技术设计 §9.4）：由 HTTP 边界中间件提取，审计写入端口在
 * 调用方未显式提供时兜底填充，避免每个业务写入点逐层透传。
 * `clientRequestId` 只作留痕，绝不替换服务端生成的内部 `requestId`。
 */
export interface RequestAuditMeta {
  readonly clientRequestId: string | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

/** 技术设计：`X-Request-Id` 只接受 `[A-Za-z0-9._:-]{1,64}`，其余视为未提供。 */
const CLIENT_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;
/** 与 SSO 登录域同一上限，避免超长 UA 撑大审计行。 */
const USER_AGENT_MAX_LENGTH = 512;

const storage = new AsyncLocalStorage<RequestAuditMeta>();

export function currentRequestAuditMeta(): RequestAuditMeta | undefined {
  return storage.getStore();
}

/** 在给定请求元数据下执行回调；中间件用它包裹 Express 的 `next()`。 */
export function runWithRequestAuditMeta<T>(
  meta: RequestAuditMeta,
  callback: () => T,
): T {
  return storage.run(meta, callback);
}

/**
 * `ip_address` 是 INET 列：`"unknown"` 或代理头带入的非法值直接入库会抛错，
 * 因此不可解析一律留空，而不是让业务事务失败。
 */
export function normalizeAuditIp(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed.length === 0) {
    return null;
  }
  const withoutV4MappedPrefix = trimmed.startsWith("::ffff:")
    ? trimmed.slice("::ffff:".length)
    : trimmed;
  return isIP(withoutV4MappedPrefix) === 0 ? null : withoutV4MappedPrefix;
}

export function normalizeAuditUserAgent(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0
    ? null
    : trimmed.slice(0, USER_AGENT_MAX_LENGTH);
}

export function clientRequestIdFromHeader(
  value: string | undefined,
): string | null {
  const trimmed = value?.trim();
  return trimmed !== undefined && CLIENT_REQUEST_ID_PATTERN.test(trimmed)
    ? trimmed
    : null;
}

export function requestAuditMetaFrom(request: {
  readonly headers?: HttpHeaderBag | undefined;
  readonly ip?: string | undefined;
  readonly socket?: { readonly remoteAddress?: string | undefined } | undefined;
}): RequestAuditMeta {
  const headers = request.headers ?? {};
  return {
    clientRequestId: clientRequestIdFromHeader(
      getHeader(headers, "x-request-id"),
    ),
    ipAddress:
      normalizeAuditIp(request.ip) ??
      normalizeAuditIp(request.socket?.remoteAddress),
    userAgent: normalizeAuditUserAgent(getHeader(headers, "user-agent")),
  };
}

/**
 * 显式值优先、缺省取请求上下文、都没有则留空。独立于 HTTP 调用链的审计写入
 * （调度任务、种子脚本）没有请求上下文，行为与改造前一致。
 */
export function applyRequestAuditMeta(input: AuditWriteInput): AuditWriteInput {
  const meta = currentRequestAuditMeta();
  return {
    ...input,
    clientRequestId:
      input.clientRequestId !== undefined
        ? input.clientRequestId
        : (meta?.clientRequestId ?? null),
    ipAddress:
      input.ipAddress !== undefined
        ? normalizeAuditIp(input.ipAddress)
        : (meta?.ipAddress ?? null),
    userAgent:
      input.userAgent !== undefined
        ? normalizeAuditUserAgent(input.userAgent)
        : (meta?.userAgent ?? null),
  };
}
