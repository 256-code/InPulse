import { useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { createApiClient, type InpulseApiClient } from "@generated/api";

/**
 * B-1 草稿列表：GET /projects/{projectId}/record-drafts 的服务端签名游标
 * 分页（C-006 envelope）。任务来源草稿仍走 getTaskRecordDrafts 单页读取。
 */
export const RECORD_DRAFTS_PAGE_LIMIT = 20;

export interface RecordDraftsQueryOptions {
  readonly client?: InpulseApiClient | undefined;
  readonly projectId: number;
  readonly enabled?: boolean;
  readonly limit?: number;
}

export function useRecordDraftsQuery({
  client,
  projectId,
  enabled = true,
  limit = RECORD_DRAFTS_PAGE_LIMIT,
}: RecordDraftsQueryOptions) {
  const api = useMemo(() => client ?? createApiClient(), [client]);
  return useInfiniteQuery({
    queryKey: ["record-drafts", projectId, limit],
    queryFn: ({ pageParam, signal }) =>
      api.listRecordDrafts(
        projectId,
        {
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
