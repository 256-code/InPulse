import { useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  ApiError,
  createApiClient,
  type InpulseApiClient,
} from "@generated/api";

export const ACTIVITY_PAGE_LIMIT = 20;

export interface ActivityQueryOptions {
  readonly projectId: number;
  readonly client?: InpulseApiClient | undefined;
  readonly includeAdminOnly?: boolean;
  readonly limit?: number;
}

export function describeActivityError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return "登录状态已失效，请重新登录后再查看项目动态。";
    }
    if (error.status === 404) {
      return "项目不存在或你无权访问该项目的动态。";
    }
    if (error.status === 422) {
      return "项目动态参数无效或游标已过期，请刷新后重试。";
    }
  }
  return "项目动态服务暂时不可用，请稍后重试。";
}

export function useActivityInfiniteQuery({
  projectId,
  client,
  includeAdminOnly = false,
  limit = ACTIVITY_PAGE_LIMIT,
}: ActivityQueryOptions) {
  const apiClient = useMemo(() => client ?? createApiClient(), [client]);
  return useInfiniteQuery({
    queryKey: ["activity", projectId, includeAdminOnly, limit],
    queryFn: ({ pageParam, signal }) =>
      apiClient.getProjectActivity(
        projectId,
        {
          ...(typeof pageParam === "string" ? { cursor: pageParam } : {}),
          ...(includeAdminOnly ? { includeAdminOnly: true } : {}),
          limit,
        },
        signal ? { signal } : undefined,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.nextCursor : undefined,
  });
}
