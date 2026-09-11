import { useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  ApiError,
  createApiClient,
  type InpulseApiClient,
} from "@generated/api";

/**
 * F-20 遗留问题聚合读：R-5 GET /api/v1/leftover-items 的服务端签名游标分页。
 * 未闭环与已闭环各自独立分页，列表顺序固定 leftoverItemId DESC（服务端口径），
 * 不在前端做过滤或重排。
 */

export const LEFTOVER_ITEMS_PAGE_LIMIT = 20;

export type LeftoverBucket = "OPEN" | "CLOSED";

export interface LeftoverItemsQueryOptions {
  readonly client?: InpulseApiClient | undefined;
  readonly bucket: LeftoverBucket;
  readonly enabled?: boolean;
  readonly limit?: number;
}

export function describeIssuesError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401)
      return "登录状态已失效，请重新登录后再查看遗留问题。";
    if (error.status === 422) return "遗留问题查询参数无效，请刷新页面后重试。";
    if (error.status === 429) return "请求过于频繁，请稍后重试。";
  }
  return "遗留问题服务暂时不可用，请稍后重试。";
}

export function useLeftoverItemsQuery({
  client,
  bucket,
  enabled = true,
  limit = LEFTOVER_ITEMS_PAGE_LIMIT,
}: LeftoverItemsQueryOptions) {
  const api = useMemo(() => client ?? createApiClient(), [client]);
  return useInfiniteQuery({
    queryKey: ["leftover-items", bucket, limit],
    queryFn: ({ pageParam, signal }) =>
      api.listLeftoverItems(
        {
          bucket,
          limit,
          ...(typeof pageParam === "string" ? { cursor: pageParam } : {}),
        },
        signal ? { signal } : undefined,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.nextCursor : undefined,
    enabled,
  });
}
