import React from "react";
import { useQuery } from "@tanstack/react-query";
import type { InpulseApiClient } from "@generated/api";
export function LeftoverTaskSource({
  api,
  taskId,
}: {
  api: InpulseApiClient;
  taskId: number;
}) {
  const source = useQuery({
    queryKey: ["leftover-task-source", taskId],
    queryFn: () => api.getLeftoverTaskSource(taskId),
    retry: false,
  });
  const src = source.data?.source;
  // 链接文案带上来源记录编号与标题，避免只有一句通用文案看不出来源是哪条记录。
  const record = useQuery({
    queryKey: ["published-record", src?.projectId ?? 0, src?.recordId ?? 0],
    queryFn: ({ signal }) =>
      api.getChangeRecord(src!.projectId, src!.recordId, { signal }),
    enabled: !!src,
    retry: false,
  });
  return src ? (
    <a
      href={`/records?view=published&projectId=${src.projectId}&publishedId=${src.recordId}`}
    >
      查看遗留来源记录
      {record.data ? ` ${record.data.code} · ${record.data.title}` : ""}
    </a>
  ) : null;
}
