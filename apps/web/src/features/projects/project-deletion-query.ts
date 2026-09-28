import { useMemo } from "react";
import { useInfiniteQuery, type InfiniteData } from "@tanstack/react-query";
import {
  ApiError,
  createApiClient,
  type InpulseApiClient,
  type ProjectDeletionItem,
  type ProjectDeletionPage,
} from "@generated/api";

export const PROJECT_DELETION_PAGE_LIMIT = 20;

export interface ProjectDeletionListOptions {
  readonly client?: InpulseApiClient | undefined;
  readonly limit?: number;
  readonly enabled?: boolean;
}

export function describeProjectDeletionError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return "登录状态已失效，请重新登录后再查看项目删除记录。";
    }
    if (error.status === 422) {
      return "删除记录游标已过期，请刷新后重试。";
    }
  }
  return "项目删除记录暂时无法加载，请稍后重试。";
}

/**
 * ADR-050：删除记录是全局台账，不按项目成员关系过滤，因此只要求有效 Session；
 * 任何登录用户都能看到「哪个项目、何时、被谁删除」，但看不到项目内容。
 */
export function useProjectDeletionsQuery({
  client,
  limit = PROJECT_DELETION_PAGE_LIMIT,
  enabled = true,
}: ProjectDeletionListOptions = {}) {
  const apiClient = useMemo(() => client ?? createApiClient(), [client]);
  return useInfiniteQuery<
    ProjectDeletionPage,
    Error,
    InfiniteData<ProjectDeletionPage, string | undefined>,
    readonly ["project-deletions", number],
    string | undefined
  >({
    queryKey: ["project-deletions", limit] as const,
    queryFn: ({ pageParam, signal }) =>
      apiClient.listProjectDeletions(
        {
          ...(pageParam ? { cursor: pageParam } : {}),
          limit,
        },
        signal ? { signal } : undefined,
      ),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    retry: false,
    enabled,
  });
}

export function projectDeletionItems(
  data: InfiniteData<ProjectDeletionPage, string | undefined> | undefined,
): readonly ProjectDeletionItem[] {
  return data ? data.pages.flatMap((page) => [...page.items]) : [];
}
