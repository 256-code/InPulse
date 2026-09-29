import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  createApiClient,
  type InpulseApiClient,
  type RecordSummaryQueryRequest,
} from "@generated/api";

/** F-33 迭代总结的分组口径。 */
export type RecordSummaryGroupBy = RecordSummaryQueryRequest["groupBy"];

export interface RecordSummaryQueryOptions {
  readonly client?: InpulseApiClient | undefined;
  /** 起始自然日（含），Asia/Shanghai 日历日，YYYY-MM-DD。 */
  readonly from: string;
  /** 结束自然日（含），Asia/Shanghai 日历日，YYYY-MM-DD。 */
  readonly to: string;
  readonly groupBy: RecordSummaryGroupBy;
  /** 0 表示全部项目（服务端按 AuthorizedProjectScope 收口）。 */
  readonly projectId: number;
  /** 0 表示不按成员收窄。 */
  readonly memberId: number;
  /** 弹层关闭时不发请求。 */
  readonly enabled: boolean;
}

/**
 * F-33 迭代总结取数：GET /change-records/summary。
 * 服务端只返回事实（记录 / 已完成任务 / 遗留问题 / 缺口与计数），正文措辞由
 * 本页按事实渲染；日期、项目与分组都进 queryKey，条件一变即重新取数。
 */
export function useRecordSummaryQuery({
  client,
  from,
  to,
  groupBy,
  projectId,
  memberId,
  enabled,
}: RecordSummaryQueryOptions) {
  const api = useMemo(() => client ?? createApiClient(), [client]);
  return useQuery({
    queryKey: ["record-summary", from, to, groupBy, projectId, memberId],
    queryFn: ({ signal }) =>
      api.getRecordSummary(
        {
          from,
          to,
          groupBy,
          ...(projectId > 0 ? { projectId } : {}),
          ...(memberId > 0 ? { memberId } : {}),
        },
        signal ? { signal } : undefined,
      ),
    enabled,
    retry: false,
  });
}
