import type { QueryClient } from "@tanstack/react-query";

/**
 * 侧栏导航计数（任务中心未完成 / 遗留问题未闭环）的查询键前缀，由
 * `app/layout/shell-data.ts` 的 `useShellCounters` 写入。
 *
 * 两个计数都是服务端聚合的派生值，几乎任何写操作都可能改变它们（新建 / 完成
 * 任务、发布或作废记录产生 / 隐藏遗留项、遗留问题转任务……）。写操作有两条实现
 * 路径：React Query mutation（由 `AppProviders` 的全局 MutationCache 统一失效）
 * 和组件里直接调用生成客户端后自行失效查询键（在写成功后显式调用本函数）。
 * 任一路径漏掉失效，那个数字就只能刷新页面才更新（2026-09-22 修）。
 */
export const SHELL_COUNTERS_QUERY_KEY = ["shell-counters"] as const;

/** 写操作成功后调用：让侧栏计数重新取数（未挂载时只是标记过期，不发请求）。 */
export function invalidateShellCounters(cache: QueryClient): Promise<void> {
  return cache.invalidateQueries({ queryKey: SHELL_COUNTERS_QUERY_KEY });
}
