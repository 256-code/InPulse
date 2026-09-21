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
  "项目筛选把列表、工作状态（未完成 / 已完成）与遗留问题入口一起收窄到所选项目；我创建的按创建人维度计算。";

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
        // projectId 由 toMyTasksV1Query 统一下发：选定项目后列表、工作状态与遗留问题
        // 入口一起收敛（统计卡已从页面删除，服务端仍返回该字段）。
        ...(filters.overdue ? { overdue: true } : {}),
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
