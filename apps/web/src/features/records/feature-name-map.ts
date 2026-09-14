import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { createApiClient, type InpulseApiClient } from "@generated/api";
import { useModules } from "@features/modules/module-query";

/**
 * 迭代记录的事实区需要展示功能名称而不是裸 ID。记录接口只返回 `impactFeatureIds`，
 * 因此这里按项目并行读取各模块的功能清单，复用 `["features", projectId, moduleId]`
 * 查询键，与功能档案页共享缓存。
 */
export function useProjectFeatureNames(
  projectId: number,
  client?: InpulseApiClient,
): ReadonlyMap<number, string> {
  const api = useMemo(() => client ?? createApiClient(), [client]);
  const modules = useModules(projectId, client);
  const moduleIds = useMemo(
    () => (modules.query.data?.items ?? []).map((item) => item.id),
    [modules.query.data],
  );
  const results = useQueries({
    queries: moduleIds.map((moduleId) => ({
      queryKey: ["features", projectId, moduleId] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        api.listFeatures(projectId, moduleId, { signal }),
      retry: false,
    })),
  });
  return useMemo(() => {
    const names = new Map<number, string>();
    for (const result of results) {
      for (const item of result.data?.items ?? [])
        names.set(item.id, item.name);
    }
    return names;
  }, [results]);
}
