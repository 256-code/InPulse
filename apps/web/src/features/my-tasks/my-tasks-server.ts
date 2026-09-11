import { createApiClient, type InpulseApiClient } from "@generated/api";
import {
  fromV1MyTaskItem,
  MY_TASKS_V1_FILTER_SUPPORT,
  MY_TASKS_V1_LIMIT_DEFAULT,
  toMyTasksV1Query,
} from "./my-tasks-v1-query";
import type { MyTasksAdapter } from "./my-tasks-types";

/**
 * F-32 服务端适配器：经生成客户端调用 R-3 listMyTasks
 * （GET /api/v1/me/tasks，负责人固定为当前会话用户）。页面默认注入本适配器；
 * mock adapter 只保留用于前端测试与降级演示。
 *
 * 第二轮契约扩展后条目字段、stats / leftoverCount / leftoverSample 与
 * priority / includeCanceled 筛选均已接线；仅 scopeCounts 为 A 裁决 §10.3
 * 延后项，保持 null（范围计数不渲染）。适配器不补值、不吞错。
 *
 * 任务聚合组区块由 R-7 listTaskGroups 提供（GET /api/v1/task-groups，
 * 授权范围由服务端 AuthorizedProjectScope 决定）；projectId 非空时按项目
 * 过滤，否则跨项目返回；未接入时不隐藏区块，由视图渲染空态或错误态。
 */

export const MY_TASKS_SERVER_NOTICE =
  "任务中心已接入服务端聚合读接口（GET /api/v1/me/tasks，默认展示当前用户负责的任务）。" +
  "统计卡片、遗留问题入口、优先级与「未完成并含已取消」筛选为服务端实时数据；" +
  "契约暂未提供：范围计数（「我创建的 / 全部任务 / 全部可访问项目」）、合并关系、" +
  "GitHub 关联与关键词搜索筛选，已禁用并标注，待契约扩展后接入。";

export function createMyTasksServerAdapter(
  client?: InpulseApiClient | undefined,
): MyTasksAdapter {
  const api = client ?? createApiClient();
  return {
    source: "server",
    notice: MY_TASKS_SERVER_NOTICE,
    fetchMyTasks: async ({ filters }) => {
      const page = await api.listMyTasks(
        toMyTasksV1Query(filters, { limit: MY_TASKS_V1_LIMIT_DEFAULT }),
      );
      return {
        items: page.items.map(fromV1MyTaskItem),
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
        stats: page.stats,
        scopeCounts: null,
        leftoverCount: page.leftoverCount,
        leftoverSample: page.leftoverSample,
        filterSupport: MY_TASKS_V1_FILTER_SUPPORT,
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
