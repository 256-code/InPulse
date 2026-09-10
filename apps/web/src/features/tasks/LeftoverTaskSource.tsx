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
  return source.data?.source ? (
    <a
      href={`/records?view=published&projectId=${source.data.source.projectId}&publishedId=${source.data.source.recordId}`}
    >
      查看遗留来源记录
    </a>
  ) : null;
}
