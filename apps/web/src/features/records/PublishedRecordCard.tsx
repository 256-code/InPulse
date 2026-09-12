import React from "react";
import { InpulseIcon } from "@features/common/components/InpulseIcon";
import type { InpulseApiClient, RecordFeedItem } from "@generated/api";
import { CalmBadge } from "@features/common/components/Calm";
import { PublishedRecordDetail } from "@features/published-records/PublishedRecordDetail";

type RecordStatus = RecordFeedItem["record"]["status"];

export function recordStatusLabel(status: RecordStatus) {
  return status === "VOID" ? "已作废" : "已发布";
}

/**
 * B-3a：设计师稿 record-card——摘要行常驻，展开后在卡片内加载详情、版本对比、
 * GitHub 关联与生命周期操作。展开状态由调用方（记录页 URL 的 publishedId）驱动。
 * B-3b：卡片接收跨项目清单条目（B-3b 名称回填），展开区按记录自身 projectId 读取，
 * 因此同一条卡片在「全部项目」视图下也能打开详情、版本与生命周期操作。
 */
export function PublishedRecordCard({
  item,
  open,
  onToggle,
  client,
  writable,
  onListChanged,
}: {
  readonly item: RecordFeedItem;
  readonly open: boolean;
  readonly onToggle: (open: boolean) => void;
  readonly client?: InpulseApiClient | undefined;
  readonly writable: boolean;
  readonly onListChanged?: (() => void) | undefined;
}) {
  const record = item.record;
  return (
    <details
      className={
        "record-card" + (record.status === "VOID" ? " record-voided" : "")
      }
      open={open}
      onToggle={(event) => onToggle(event.currentTarget.open)}
    >
      <summary>
        <span className="record-symbol">
          <InpulseIcon name="gitBranch" size={18} />
        </span>
        <span className="record-summary-text">
          <strong>{record.title}</strong>
          <small>
            {record.code} · v{record.currentVersion} · 发布{" "}
            {new Date(record.publishedAt).toLocaleString("zh-CN")} ·{" "}
            {item.author.name}
          </small>
          <small className="record-summary-path">
            归属 {item.projectName} / {item.moduleName}
            {item.featureName === null ? "" : ` / ${item.featureName}`}
          </small>
        </span>
        <span className="record-summary-badges">
          {record.scopeType === "MODULE" ? (
            <CalmBadge tone="violet">模块级</CalmBadge>
          ) : null}
          {record.currentVersion > 1 ? (
            <CalmBadge tone="cyan">v{record.currentVersion}</CalmBadge>
          ) : null}
          <CalmBadge tone={record.status === "VOID" ? "red" : "green"}>
            {recordStatusLabel(record.status)}
          </CalmBadge>
        </span>
        <InpulseIcon name="chevronRight" size={16} />
      </summary>
      {open ? (
        <PublishedRecordDetail
          projectId={record.projectId}
          recordId={record.id}
          client={client}
          writable={writable}
          onListChanged={onListChanged}
        />
      ) : null}
    </details>
  );
}
