import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@generated/api";
import { PROJECT_OVERVIEW_MOCK_ADAPTER } from "./project-overview-mock";
import type { ProjectOverviewAdapter } from "./project-overview-types";

/**
 * F-29 数据访问层。骨架阶段默认使用 mock adapter；接口冻结后新增 server
 * adapter 并在页面注入，本文件与页面结构不变。
 */

export function describeProjectOverviewError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401)
      return "登录状态已失效，请重新登录后再查看项目概览。";
    if (error.status === 404) return "项目不存在或已无权访问。";
    if (error.status === 429) return "请求过于频繁，请稍后重试。";
  }
  return "项目概览暂时不可用，请稍后重试。";
}

export interface UseProjectOverviewQueryOptions {
  readonly projectId: number;
  readonly adapter?: ProjectOverviewAdapter;
}

export function useProjectOverviewQuery({
  projectId,
  adapter = PROJECT_OVERVIEW_MOCK_ADAPTER,
}: UseProjectOverviewQueryOptions) {
  return useQuery({
    queryKey: ["project-overview", adapter.source, projectId],
    queryFn: () => adapter.fetchProjectOverview({ projectId }),
    retry: false,
  });
}
