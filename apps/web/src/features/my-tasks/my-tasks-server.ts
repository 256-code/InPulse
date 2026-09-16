import { createApiClient, type InpulseApiClient } from "@generated/api";
import {
  fromV1MyTaskItem,
  MY_TASKS_V1_FILTER_SUPPORT,
  MY_TASKS_V1_LIMIT_DEFAULT,
  toMyTasksV1Query,
} from "./my-tasks-v1-query";
import type { MyTasksAdapter } from "./my-tasks-types";

/** 任务中心经生成客户端查询；任务和聚合组均传递服务端签名游标。 */

export const MY_TASKS_SERVER_NOTICE =
  "按项目查看项目内全员任务；全部任务仅供管理员使用。统计卡片仍按我负责的任务计算。";

export function createMyTasksServerAdapter(
  client?: InpulseApiClient | undefined,
): MyTasksAdapter {
  const api = client ?? createApiClient();
  return {
    source: "server",
    notice: MY_TASKS_SERVER_NOTICE,
    fetchMyTasks: async ({ filters, cursor }) => {
      const page = await api.listTaskCenter({
        ...toMyTasksV1Query(filters, {
          limit: MY_TASKS_V1_LIMIT_DEFAULT,
          ...(cursor ? { cursor } : {}),
        }),
        scope: filters.scope,
        ...(filters.overdue
          ? {
              overdue: true,
              ...(filters.projectId !== null
                ? { projectId: filters.projectId }
                : {}),
            }
          : {}),
      });
      return {
        items: page.items.map(fromV1MyTaskItem),
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
        stats: page.stats,
        scopeCounts: null,
        leftoverCount: page.leftoverCount,
        leftoverSample: page.leftoverSample,
        filterSupport: { ...MY_TASKS_V1_FILTER_SUPPORT, "scope:all": true },
      };
    },
    fetchTaskGroups: async ({ projectId, cursor }) => {
      const page = await api.listTaskGroups({
        limit: MY_TASKS_V1_LIMIT_DEFAULT,
        ...(projectId === null ? {} : { projectId }),
        ...(cursor === null ? {} : { cursor }),
      });
      return {
        items: page.items,
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
      };
    },
  };
}
