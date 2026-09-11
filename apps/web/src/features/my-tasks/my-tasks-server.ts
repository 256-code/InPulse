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
 * 契约缺口按显式降级处理，不补值、不吞错：
 * - stats / scopeCounts / leftoverCount / leftoverSample 返回 null；
 * - filterSupport 全 false，UI 禁用并标注未接入的筛选项；
 * - 条目只映射 R-3 字段，骨架字段（优先级、截止时间等）保持 undefined。
 *
 * 任务聚合组区块由 R-6 listTaskGroups 提供（GET /api/v1/task-groups，
 * 授权范围由服务端 AuthorizedProjectScope 决定）；projectId 非空时按项目
 * 过滤，否则跨项目返回；未接入时不隐藏区块，由视图渲染空态或错误态。
 */

export const MY_TASKS_SERVER_NOTICE =
  "任务中心已接入服务端聚合读接口（GET /api/v1/me/tasks，默认展示当前用户负责的任务）。" +
  "契约未提供：统计卡片、范围计数与遗留问题（显示为「—」或隐藏）；" +
  "优先级、截止时间、合并关系、GitHub 关联、关键词搜索与「我创建的 / 全部任务 / 全部可访问项目」筛选已禁用标注，待契约扩展后接入。";

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
        stats: null,
        scopeCounts: null,
        leftoverCount: null,
        leftoverSample: null,
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
