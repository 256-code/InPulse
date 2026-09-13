import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { createApiClient, type InpulseApiClient } from "@generated/api";
import { useFeatures } from "@features/features/feature-query";
import { useModules } from "@features/modules/module-query";
import { useProjectDetail } from "@features/projects/project-query";

/**
 * 应用外壳（侧栏导航计数 + 顶栏面包屑）所需的只读数据。
 *
 * 设计师稿 components/sidebar.tsx 用 `myOpenTaskCount` / `leftoverCount`
 * 渲染导航计数，components/topbar.tsx 在「项目与功能」视图渲染
 * 项目 → 模块 → 功能 三段面包屑。两者都只能从既有只读聚合接口取数，
 * 这里集中接线，避免外壳散落多个 query。
 */

const SHELL_COUNTER_STALE_TIME = 60_000;
/** R-6 单页上限（AGGREGATE_READ_PAGE_LIMIT_MAX）；超出时只显示上限值。 */
const SHELL_COUNTER_PAGE_LIMIT = 100;

export interface ShellQueryOptions {
  readonly client?: InpulseApiClient | undefined;
  readonly enabled?: boolean;
}

export interface ShellCounters {
  /** 我负责的未完成数量（R-3 `stats.myOpen`）；null 表示尚未加载或不可用。 */
  readonly myOpenTaskCount: number | null;
  /** 未闭环遗留项数量（R-6 `bucket=OPEN`）；null 表示尚未加载或不可用。 */
  readonly openLeftoverCount: number | null;
}

export function useShellCounters({
  client,
  enabled = true,
}: ShellQueryOptions): ShellCounters {
  const api = useMemo(() => client ?? createApiClient(), [client]);

  const tasks = useQuery({
    queryKey: ["shell-counters", "my-open-tasks"],
    queryFn: ({ signal }) => api.listMyTasks({ limit: 1 }, { signal }),
    enabled,
    staleTime: SHELL_COUNTER_STALE_TIME,
    retry: false,
  });

  const leftovers = useQuery({
    queryKey: ["shell-counters", "open-leftovers"],
    queryFn: ({ signal }) =>
      api.listLeftoverItems(
        { bucket: "OPEN", limit: SHELL_COUNTER_PAGE_LIMIT },
        { signal },
      ),
    enabled,
    staleTime: SHELL_COUNTER_STALE_TIME,
    retry: false,
  });

  const leftoverPage = leftovers.data;
  return {
    myOpenTaskCount: tasks.data?.stats.myOpen ?? null,
    openLeftoverCount: leftoverPage
      ? leftoverPage.hasMore
        ? SHELL_COUNTER_PAGE_LIMIT
        : leftoverPage.items.length
      : null,
  };
}

export interface CatalogTrail {
  readonly projectName: string | null;
  readonly moduleName: string | null;
  readonly featureName: string | null;
}

export interface CatalogTrailOptions extends ShellQueryOptions {
  readonly projectId: number | null;
  readonly moduleId: number | null;
  readonly featureId: number | null;
}

/**
 * `项目与功能` 视图的面包屑名称（项目 → 模块 → 功能）。
 * projectId 传 null 时全部查询禁用，非 catalog 路由不会产生额外读。
 */
export function useCatalogTrail({
  projectId,
  moduleId,
  featureId,
  client,
  enabled = true,
}: CatalogTrailOptions): CatalogTrail {
  const scoped = enabled && projectId !== null && moduleId !== null;
  const project = useProjectDetail({
    client,
    projectId,
    enabled: enabled && projectId !== null,
  });
  const modules = useModules(scoped ? projectId : 0, client);
  const features = useFeatures(
    scoped ? projectId : 0,
    scoped ? moduleId : 0,
    undefined,
    client,
  );

  const moduleList = modules.query.data?.items;
  const featureList = features.query.data?.items;

  return {
    projectName: project.data?.name ?? null,
    moduleName:
      moduleId === null
        ? null
        : (moduleList?.find((item) => item.id === moduleId)?.name ?? null),
    featureName:
      featureId === null
        ? null
        : (featureList?.find((item) => item.id === featureId)?.name ?? null),
  };
}
