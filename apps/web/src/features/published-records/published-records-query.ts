import { useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { createApiClient, type InpulseApiClient } from "@generated/api";

/**
 * B-1 正式记录列表：GET /projects/{projectId}/change-records 的服务端签名
 * 游标分页（C-006 envelope）。状态筛选变化时重新从第一页开始，不在前端重排。
 */
export const PUBLISHED_RECORDS_PAGE_LIMIT = 20;

export interface ChangeRecordsQueryOptions {
  readonly client?: InpulseApiClient | undefined;
  readonly projectId: number;
  readonly status: "PUBLISHED" | "VOID";
  readonly enabled?: boolean;
  readonly limit?: number;
}

export function useChangeRecordsQuery({
  client,
  projectId,
  status,
  enabled = true,
  limit = PUBLISHED_RECORDS_PAGE_LIMIT,
}: ChangeRecordsQueryOptions) {
  const api = useMemo(() => client ?? createApiClient(), [client]);
  return useInfiniteQuery({
    queryKey: ["published-records", projectId, status, limit],
    queryFn: ({ pageParam, signal }) =>
      api.listChangeRecords(
        projectId,
        {
          status,
          limit,
          ...(typeof pageParam === "string" ? { cursor: pageParam } : {}),
        },
        signal ? { signal } : undefined,
      ),
    initialPageParam: undefined as string | undefined,
    retry: false,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? (lastPage.nextCursor ?? undefined) : undefined,
    enabled: enabled && projectId > 0,
  });
}
