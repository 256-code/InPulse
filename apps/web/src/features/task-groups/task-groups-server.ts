import { createApiClient, type InpulseApiClient } from "@generated/api";
import type { TaskGroupAdapter } from "./task-groups-types";

/**
 * F-25 服务端适配器：经生成客户端调用 R-1 getTaskGroup 与 R-4
 * listTaskGroupRecords。页面默认注入本适配器；每页条数固定为契约默认 20
 * （AGGREGATE_READ_PAGE_LIMIT_DEFAULT），不依赖隐式默认值。
 *
 * 契约语义（记录只含已发布/已作废、GitHub 链接为关联时刻快照）由页面文案
 * 与空态承担；设计师稿 task-center.tsx 的聚合组区块没有任何「接口说明」黄条，
 * 因此这里不再携带开发期说明文本。
 */

export function createTaskGroupServerAdapter(
  client?: InpulseApiClient | undefined,
): TaskGroupAdapter {
  const api = client ?? createApiClient();
  return {
    source: "server",
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
