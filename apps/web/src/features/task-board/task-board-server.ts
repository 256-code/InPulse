import { createApiClient, type InpulseApiClient } from "@generated/api";

import type { TaskBoardAdapter } from "./task-board-types";

/**
 * R-8 服务端适配器：经生成客户端调用 getProjectTaskBoard
 * （GET /api/v1/projects/{projectId}/task-board）。页面默认注入本适配器；
 * 测试注入内存实现。适配器不补值、不吞错，错误原样抛给页面统一描述。
 */

export const TASK_BOARD_SERVER_NOTICE =
  "任务看板已接入服务端聚合读接口（GET /api/v1/projects/{projectId}/task-board）；" +
  "统计、泳道与任务卡均为服务端实时数据，逾期与今日到期按 Asia/Shanghai 计算。";

export function createTaskBoardServerAdapter(
  client?: InpulseApiClient | undefined,
): TaskBoardAdapter {
  const api = client ?? createApiClient();
  return {
    source: "server",
    notice: TASK_BOARD_SERVER_NOTICE,
    fetchTaskBoard: ({ projectId }) => api.getProjectTaskBoard(projectId),
  };
}
