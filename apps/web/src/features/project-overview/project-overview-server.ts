import { createApiClient, type InpulseApiClient } from "@generated/api";
import {
  fromV1ProjectOverview,
  toProjectOverviewV1Query,
} from "./project-overview-v1";
import type { ProjectOverviewAdapter } from "./project-overview-types";

/**
 * F-29 服务端适配器：经生成客户端调用 R-2 getProjectOverview
 * （GET /api/v1/projects/{projectId}/overview）。页面默认注入本适配器；
 * mock adapter 只保留用于前端测试与降级演示。
 *
 * 契约缺口（openLeftovers 总数、leftover.recordTitle）由映射层记为 null，
 * 显示层据此显式降级；本适配器不补值、不吞错，错误原样抛给页面统一描述。
 */

export const PROJECT_OVERVIEW_SERVER_NOTICE =
  "项目概览已接入服务端聚合读接口（GET /api/v1/projects/{projectId}/overview）。" +
  "活跃模块、活跃功能、未完成任务、迭代记录、最近迭代与遗留问题列表为服务端实时数据；" +
  "契约未提供遗留问题总数（显示为「—」）与来源记录标题（仅展示记录编号）。";

export function createProjectOverviewServerAdapter(
  client?: InpulseApiClient | undefined,
): ProjectOverviewAdapter {
  const api = client ?? createApiClient();
  return {
    source: "server",
    notice: PROJECT_OVERVIEW_SERVER_NOTICE,
    fetchProjectOverview: async ({ projectId }) => {
      const response = await api.getProjectOverview(
        projectId,
        toProjectOverviewV1Query(),
      );
      return fromV1ProjectOverview(response);
    },
  };
}
