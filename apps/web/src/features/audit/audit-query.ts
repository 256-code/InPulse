import { useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  ApiError,
  createApiClient,
  type InpulseApiClient,
} from "@generated/api";

/**
 * F-08 原始审计读取（GET /api/v1/audit-logs）的服务端签名游标分页。
 * limit 使用契约默认值 50（最大 100）；列表顺序由服务端按链序号保证，
 * 前端不重排、不跨链合并，也不解析或修改不透明游标。
 */
export const AUDIT_PAGE_LIMIT = 50;

export type AuditChain =
  | { readonly kind: "system" }
  | { readonly kind: "project"; readonly projectId: number };

export interface AuditFilters {
  readonly action: string;
  readonly actorId: string;
  readonly from: string;
  readonly to: string;
}

export const EMPTY_AUDIT_FILTERS: AuditFilters = {
  action: "",
  actorId: "",
  from: "",
  to: "",
};

export interface NormalizedAuditFilters {
  readonly action: string | undefined;
  readonly actorId: number | undefined;
  readonly from: string | undefined;
  readonly to: string | undefined;
}

export function auditChainKey(chain: AuditChain): string {
  return chain.kind === "system" ? "SYSTEM" : "PROJECT:" + chain.projectId;
}

export function isAdminReauthRequired(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 403 &&
    error.code === "ADMIN_REAUTH_REQUIRED"
  );
}

export function describeAuditError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return "登录状态已失效，请重新登录后再读取原始审计。";
    }
    if (error.status === 403) {
      return error.code === "ADMIN_REAUTH_REQUIRED"
        ? "请先完成管理员安全验证（管理员密码 + 当前 TOTP）后再读取原始审计。"
        : "原始审计仅系统管理员可读取。";
    }
    if (error.status === 422) {
      return "审计查询参数无效或游标已过期，请调整筛选后重试。";
    }
    if (error.status === 429) {
      return "审计读取请求过于频繁，请稍后重试。";
    }
    if (error.status === 500) {
      return "服务器无法完成原始审计读取，请稍后重试。";
    }
  }
  return "原始审计服务暂时不可用，请稍后重试。";
}

/** datetime-local 值按浏览器本地时区解析为带时区的 ISO 串；无效返回 undefined。 */
export function toQueryIsoString(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed.toISOString();
}

/** 提交前校验；返回错误文案或 null。服务端仍会独立校验同一套规则。 */
export function validateAuditFilters(filters: AuditFilters): string | null {
  const actorId = filters.actorId.trim();
  if (
    actorId.length > 0 &&
    (!/^[0-9]+$/.test(actorId) || Number(actorId) < 1)
  ) {
    return "操作人 ID 必须是正整数。";
  }
  const from = filters.from.trim();
  const to = filters.to.trim();
  if (from.length > 0 && toQueryIsoString(from) === undefined) {
    return "开始时间格式无效，请重新选择。";
  }
  if (to.length > 0 && toQueryIsoString(to) === undefined) {
    return "结束时间格式无效，请重新选择。";
  }
  const fromIso = toQueryIsoString(from);
  const toIso = toQueryIsoString(to);
  if (
    fromIso !== undefined &&
    toIso !== undefined &&
    new Date(fromIso).getTime() >= new Date(toIso).getTime()
  ) {
    return "开始时间必须早于结束时间（服务端按半开区间 [from, to) 过滤）。";
  }
  return null;
}

export function normalizeAuditFilters(
  filters: AuditFilters,
): NormalizedAuditFilters {
  const action = filters.action.trim();
  const actorId = filters.actorId.trim();
  return {
    action: action.length > 0 ? action : undefined,
    actorId: actorId.length > 0 ? Number(actorId) : undefined,
    from: toQueryIsoString(filters.from),
    to: toQueryIsoString(filters.to),
  };
}

export interface AuditLogsQueryOptions {
  readonly client?: InpulseApiClient | undefined;
  readonly chain: AuditChain;
  readonly filters: AuditFilters;
  readonly enabled?: boolean;
}

export function useAuditLogsInfiniteQuery({
  client,
  chain,
  filters,
  enabled = true,
}: AuditLogsQueryOptions) {
  const api = useMemo(() => client ?? createApiClient(), [client]);
  const normalized = useMemo(() => normalizeAuditFilters(filters), [filters]);
  const chainKey = auditChainKey(chain);
  return useInfiniteQuery({
    queryKey: [
      "audit-logs",
      chainKey,
      normalized.action ?? "",
      normalized.actorId ?? null,
      normalized.from ?? "",
      normalized.to ?? "",
    ],
    queryFn: ({ pageParam, signal }) =>
      api.getAuditLogs(
        {
          ...(chain.kind === "project" ? { projectId: chain.projectId } : {}),
          ...(normalized.action !== undefined
            ? { action: normalized.action }
            : {}),
          ...(normalized.actorId !== undefined
            ? { actorId: normalized.actorId }
            : {}),
          ...(normalized.from !== undefined ? { from: normalized.from } : {}),
          ...(normalized.to !== undefined ? { to: normalized.to } : {}),
          ...(typeof pageParam === "string" ? { cursor: pageParam } : {}),
          limit: AUDIT_PAGE_LIMIT,
        },
        signal ? { signal } : undefined,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.nextCursor : undefined,
    enabled,
    retry: false,
  });
}
