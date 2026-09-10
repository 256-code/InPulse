import { createApiClient, type InpulseApiClient } from "@generated/api";
import type { TaskGroupAdapter } from "./task-groups-types";

/**
 * F-25 服务端适配器：经生成客户端调用 R-1 getTaskGroup 与 R-4
 * listTaskGroupRecords。页面默认注入本适配器；每页条数固定为契约默认 20
 * （AGGREGATE_READ_PAGE_LIMIT_DEFAULT），不依赖隐式默认值。
 */

export const TASK_GROUP_SERVER_NOTICE =
  "聚合组数据来自服务端读取接口（R-1 / R-4）；记录只包含已发布与已作废状态，" +
  "GitHub 链接标题与状态为关联时刻快照，不代表远程实时状态。";

export function createTaskGroupServerAdapter(
  client?: InpulseApiClient | undefined,
): TaskGroupAdapter {
  const api = client ?? createApiClient();
  return {
    source: "server",
    notice: TASK_GROUP_SERVER_NOTICE,
    fetchTaskGroup: (groupId) => api.getTaskGroup(groupId),
    fetchTaskGroupRecords: (groupId, query) =>
      api.listTaskGroupRecords(groupId, {
        ...(query.memberTaskId === undefined
          ? {}
          : { memberTaskId: query.memberTaskId }),
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        limit: 20,
      }),
  };
}
