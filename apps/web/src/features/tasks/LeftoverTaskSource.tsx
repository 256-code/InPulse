import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { InpulseApiClient } from "@generated/api";
import {
  RecordDetailModal,
  recordDetailTarget,
} from "@features/published-records/RecordDetailModal";
export function LeftoverTaskSource({
  api,
  taskId,
}: {
  api: InpulseApiClient;
  taskId: number;
}) {
  const [open, setOpen] = useState(false);
  const source = useQuery({
    queryKey: ["leftover-task-source", taskId],
    queryFn: () => api.getLeftoverTaskSource(taskId),
    retry: false,
  });
  const src = source.data?.source;
  // 入口文案带上来源记录编号与标题，避免只有一句通用文案看不出来源是哪条记录。
  const record = useQuery({
    queryKey: ["published-record", src?.projectId ?? 0, src?.recordId ?? 0],
    queryFn: ({ signal }) =>
      api.getChangeRecord(src!.projectId, src!.recordId, { signal }),
    enabled: !!src,
    retry: false,
  });
  if (!src) return null;
  const detail = record.data;
  return (
    <>
      {/* 2026-09-28 产品反馈：入口由整页跳转到记录工作区改为就地打开记录详情弹窗
          （与任务详情「迭代记录」标签同一实现），不再离开当前任务。 */}
      <button
        type="button"
        className="leftover-source-open"
        disabled={detail === undefined}
        title={
          detail === undefined
            ? "来源记录加载中或当前不可读"
            : "打开来源记录详情"
        }
        onClick={() => setOpen(true)}
      >
        查看遗留来源记录
        {detail ? ` ${detail.code} · ${detail.title}` : ""}
      </button>
      {open && detail !== undefined ? (
        <RecordDetailModal
          projectId={src.projectId}
          record={recordDetailTarget(detail)}
          api={api}
          onClose={() => setOpen(false)}
          onChanged={() => {
            // 修订与作废都会改正文和状态；来源不再 PUBLISHED 时该接口返回 source=null，
            // 一并重读，让入口按契约自行消失。
            void record.refetch();
            void source.refetch();
          }}
        />
      ) : null}
    </>
  );
}
