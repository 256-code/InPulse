import { useMemo } from "react";
import { useInfiniteQuery, type InfiniteData } from "@tanstack/react-query";
import {
  ApiError,
  createApiClient,
  type ActivityItem,
  type InpulseApiClient,
} from "@generated/api";

export const ACTIVITY_PAGE_LIMIT = 20;

/** 每个项目在上一轮里的游标；没有条目的项目表示已经读完。 */
export type ActivityCursorMap = Readonly<Record<string, string>>;

export interface ActivityFeedPage {
  readonly items: readonly ActivityItem[];
  readonly next: ActivityCursorMap | null;
}

export interface ActivityFeedOptions {
  /** 要聚合的项目；设计稿的「全部项目」即把当前账号可见的项目全部传入。 */
  readonly projectIds: readonly number[];
  readonly client?: InpulseApiClient | undefined;
  readonly includeAdminOnly?: boolean;
  readonly limit?: number;
  readonly enabled?: boolean;
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

function occurTime(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function idOrder(id: string): number {
  const parsed = Number(id);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** 多项目轮次合并成一条时间倒序流；同秒事件按 ID 倒序保证顺序稳定。 */
export function mergeActivityPages(
  pages: readonly ActivityFeedPage[],
): readonly ActivityItem[] {
  return pages
    .flatMap((page) => [...page.items])
    .sort((left, right) => {
      const delta = occurTime(right.occurredAt) - occurTime(left.occurredAt);
      return delta !== 0 ? delta : idOrder(right.id) - idOrder(left.id);
    });
}

/**
 * 项目动态接口是「一个项目一条游标」的分页，设计稿则是一个能看全部项目的单页，
 * 因此这里按项目并发取数并按轮次合并：首轮覆盖所有项目，之后只对仍有下一页的
 * 项目继续取，「加载更多」等于整体再推进一轮。
 */
export function useActivityFeedQuery({
  projectIds,
  client,
  includeAdminOnly = false,
  limit = ACTIVITY_PAGE_LIMIT,
  enabled = true,
}: ActivityFeedOptions) {
  const apiClient = useMemo(() => client ?? createApiClient(), [client]);
  const scope = projectIds.join(",");
  return useInfiniteQuery<
    ActivityFeedPage,
    Error,
    InfiniteData<ActivityFeedPage, ActivityCursorMap | undefined>,
    readonly ["activity", string, boolean, number],
    ActivityCursorMap | undefined
  >({
    queryKey: ["activity", scope, includeAdminOnly, limit] as const,
    queryFn: async ({ pageParam, signal }) => {
      const targetIds = pageParam
        ? Object.keys(pageParam).map(Number)
        : [...projectIds];
      const pages = await Promise.all(
        targetIds.map((projectId) => {
          const cursor = pageParam?.[String(projectId)];
          return apiClient.getProjectActivity(
            projectId,
            {
              ...(cursor ? { cursor } : {}),
              ...(includeAdminOnly ? { includeAdminOnly: true } : {}),
              limit,
            },
            signal ? { signal } : undefined,
          );
        }),
      );
      const next: Record<string, string> = {};
      pages.forEach((page, index) => {
        if (page.hasMore && page.nextCursor) {
          next[String(targetIds[index])] = page.nextCursor;
        }
      });
      return {
        items: pages.flatMap((page) => [...page.items]),
        next: Object.keys(next).length > 0 ? next : null,
      };
    },
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.next ?? undefined,
    enabled: enabled && projectIds.length > 0,
  });
}
