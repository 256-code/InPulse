import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ApiError } from "@generated/api";
import { MY_TASKS_MOCK_ADAPTER } from "./my-tasks-mock";
import type { MyTaskFilters, MyTasksAdapter } from "./my-tasks-types";

/**
 * F-32 数据访问层。骨架阶段默认使用 mock adapter；接口冻结后新增
 * server adapter 并在页面注入，本文件与页面结构不变。
 */

export function describeMyTasksError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401)
      return "登录状态已失效，请重新登录后再查看我的任务。";
    if (error.status === 422)
      return "任务筛选参数无效或游标已过期，请刷新后重试。";
    if (error.status === 429) return "请求过于频繁，请稍后重试。";
  }
  return "任务列表暂时不可用，请稍后重试。";
}

export interface UseMyTasksQueryOptions {
  readonly filters: MyTaskFilters;
  readonly viewerId: number | null;
  readonly adapter?: MyTasksAdapter;
}

export interface UseMyTaskGroupsQueryOptions {
  /** 按项目范围筛选时传入当前项目；null 表示跨项目（服务端授权范围）。 */
  readonly projectId: number | null;
  readonly adapter?: MyTasksAdapter;
}

/**
 * R-7 任务聚合组列表：按 groupId 倒序签名游标分页；服务端已按
 * AuthorizedProjectScope 过滤，非成员项目不会出现在结果中。
 * 失败时不隐藏「任务聚合组」区块，由视图渲染错误态。
 */
export function useMyTaskGroupsQuery({
  projectId,
  adapter = MY_TASKS_MOCK_ADAPTER,
}: UseMyTaskGroupsQueryOptions) {
  return useInfiniteQuery({
    queryKey: ["my-task-groups", adapter.source, projectId],
    queryFn: ({ pageParam }) =>
      adapter.fetchTaskGroups({ projectId, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.hasMore ? last.nextCursor : undefined),
    retry: false,
  });
}

export function useMyTasksQuery({
  filters,
  viewerId,
  adapter = MY_TASKS_MOCK_ADAPTER,
}: UseMyTasksQueryOptions) {
  return useQuery({
    queryKey: ["my-tasks", adapter.source, viewerId, filters],
    queryFn: () => adapter.fetchMyTasks({ filters, viewerId }),
    retry: false,
  });
}
