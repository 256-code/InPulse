import React from "react";
import { InpulseIcon } from "@features/common/components/InpulseIcon";
import type { InpulseApiClient, ReadableRecord } from "@generated/api";
import { CalmBadge } from "@features/common/components/Calm";
import { PublishedRecordDetail } from "@features/published-records/PublishedRecordDetail";

export function recordStatusLabel(status: ReadableRecord["status"]) {
  return status === "VOID" ? "已作废" : "已发布";
}

/**
 * B-3a：设计师稿 record-card——摘要行常驻，展开后在卡片内加载详情、版本对比、
 * GitHub 关联与生命周期操作。展开状态由调用方（记录页 URL 的 publishedId）驱动。
 */
export function PublishedRecordCard({
  item,
  projectId,
  open,
  onToggle,
  client,
  writable,
  onListChanged,
}: {
  readonly item: ReadableRecord;
  readonly projectId: number;
  readonly open: boolean;
  readonly onToggle: (open: boolean) => void;
  readonly client?: InpulseApiClient | undefined;
  readonly writable: boolean;
  readonly onListChanged?: (() => void) | undefined;
}) {
  return (
    <details
      className={
        "record-card" + (item.status === "VOID" ? " record-voided" : "")
      }
      open={open}
      onToggle={(event) => onToggle(event.currentTarget.open)}
    >
      <summary>
        <span className="record-symbol">
          <InpulseIcon name="gitBranch" size={18} />
        </span>
        <span className="record-summary-text">
          <strong>{item.title}</strong>
          <small>
            {item.code} · v{item.currentVersion} · 发布{" "}
            {new Date(item.publishedAt).toLocaleString("zh-CN")}
          </small>
        </span>
        <span className="record-summary-badges">
          {item.scopeType === "MODULE" ? (
            <CalmBadge tone="violet">模块级</CalmBadge>
          ) : null}
          {item.currentVersion > 1 ? (
            <CalmBadge tone="cyan">v{item.currentVersion}</CalmBadge>
          ) : null}
          <CalmBadge tone={item.status === "VOID" ? "red" : "green"}>
            {recordStatusLabel(item.status)}
          </CalmBadge>
        </span>
        <InpulseIcon name="chevronRight" size={16} />
      </summary>
      {open ? (
        <PublishedRecordDetail
          projectId={projectId}
          recordId={item.id}
          client={client}
          writable={writable}
          onListChanged={onListChanged}
        />
      ) : null}
    </details>
  );
}
