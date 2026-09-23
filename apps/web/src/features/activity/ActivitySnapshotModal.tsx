import React, { useMemo } from "react";
import type {
  AuditLogItem,
  ActivityItem,
  InpulseApiClient,
} from "@generated/api";
import { AppModal } from "@features/common/components/AppModal";
import { InpulseIcon } from "@features/common/components/InpulseIcon";
import {
  EMPTY_AUDIT_FILTERS,
  describeAuditError,
  useAuditLogsInfiniteQuery,
  type AuditFilters,
} from "@features/audit/audit-query";
import { activitySubject } from "./activity-labels";

/** 动态投影与审计链一一对应，时间窗只需覆盖同一事务内的相邻写入。 */
const SNAPSHOT_WINDOW_MS = 1000;

export interface ActivitySnapshotModalProps {
  readonly item: ActivityItem | null;
  readonly actorName: string;
  readonly projectName: string;
  readonly client?: InpulseApiClient | undefined;
  readonly onClose: () => void;
}

function formatSnapshotTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  const date = [
    parsed.getFullYear(),
    String(parsed.getMonth() + 1).padStart(2, "0"),
    String(parsed.getDate()).padStart(2, "0"),
  ].join("-");
  const time = [
    String(parsed.getHours()).padStart(2, "0"),
    String(parsed.getMinutes()).padStart(2, "0"),
    String(parsed.getSeconds()).padStart(2, "0"),
  ].join(":");
  return `${date} ${time}`;
}

function snapshotPayloadText(entry: AuditLogItem): string {
  try {
    return JSON.stringify(entry.eventPayload, null, 2);
  } catch {
    return "事件载荷无法序列化";
  }
}

/**
 * 「原始快照」需要有效的系统管理员 Session，且 `GET /api/v1/audit-logs`
 * 只能按链 + 时间窗 + 操作人过滤，没有链序号参数；因此这里用动态与审计
 * 一一对应的特性（同一 `(chain_id, sequence_no)`、同一时间戳）在时间窗内
 * 按对象 ID 定位那条记录。
 */
export const ActivitySnapshotModal: React.FC<ActivitySnapshotModalProps> = ({
  item,
  actorName,
  projectName,
  client,
  onClose,
}) => {
  const filters = useMemo<AuditFilters>(() => {
    if (item === null) {
      return EMPTY_AUDIT_FILTERS;
    }
    const occurred = Date.parse(item.occurredAt);
    if (Number.isNaN(occurred)) {
      return EMPTY_AUDIT_FILTERS;
    }
    return {
      action: "",
      actorIds: item.actorId === null ? [] : [item.actorId],
      from: new Date(occurred - SNAPSHOT_WINDOW_MS).toISOString(),
      to: new Date(occurred + SNAPSHOT_WINDOW_MS).toISOString(),
    };
  }, [item]);

  const auditQuery = useAuditLogsInfiniteQuery({
    chain: { kind: "project", projectId: item?.projectId ?? 0 },
    filters,
    ...(client ? { client } : {}),
    enabled: item !== null,
  });

  const records = useMemo(
    () => auditQuery.data?.pages.flatMap((page) => [...page.items]) ?? [],
    [auditQuery.data],
  );
  const candidates = useMemo(() => {
    if (item === null) {
      return [];
    }
    const targetId = String(item.sourceEntityId);
    const exact = records.find((entry) => entry.targetId === targetId);
    return exact ? [exact] : records;
  }, [item, records]);
  const singleCandidate = candidates.length === 1 ? candidates[0] : undefined;

  let body: React.ReactNode;
  if (!auditQuery.isSuccess) {
    body = (
      <div
        className={
          auditQuery.isError
            ? "activity-state activity-state-error"
            : "activity-state"
        }
      >
        {auditQuery.isError ? (
          <>{describeAuditError(auditQuery.error)}</>
        ) : (
          <>
            <span className="activity-spinner" />
            正在读取原始审计快照...
          </>
        )}
      </div>
    );
  } else if (candidates.length === 0) {
    body = (
      <div className="activity-state">
        审计链中没有与该动态时间戳匹配的原始记录。
      </div>
    );
  } else if (singleCandidate !== undefined) {
    const record = singleCandidate;
    body = (
      <>
        <dl className="calm-meta">
          <dt>操作</dt>
          <dd>{record.action}</dd>
          <dt>对象类型</dt>
          <dd>{record.targetType}</dd>
          <dt>对象</dt>
          <dd>{item === null ? "—" : activitySubject(item.summary)}</dd>
          <dt>对象 ID</dt>
          <dd>
            <code>{record.targetId ?? "—"}</code>
          </dd>
          <dt>项目</dt>
          <dd>{projectName + " · #" + item?.projectId}</dd>
          <dt>摘要</dt>
          <dd>{item?.summary ?? "—"}</dd>
        </dl>
        <h3>字段级变更</h3>
        <pre data-testid="activity-snapshot-payload">
          {snapshotPayloadText(record)}
        </pre>
        <p className="permission-hint">
          <InpulseIcon name="shield" size={14} />
          审计日志不允许删除；原始快照仅系统管理员可见，读取本身已留痕。
        </p>
      </>
    );
  } else {
    body = (
      <>
        <p className="permission-hint">
          <InpulseIcon name="shield" size={14} />
          同一时间窗内有多条审计记录，请按操作与对象 ID 对照原始载荷。
        </p>
        {candidates.map((record) => (
          <React.Fragment key={record.chainId + ":" + record.sequenceNo}>
            <h3>
              {record.action +
                " · 序号 " +
                record.sequenceNo +
                (record.targetId === null ? "" : " · 对象 #" + record.targetId)}
            </h3>
            <pre>{snapshotPayloadText(record)}</pre>
          </React.Fragment>
        ))}
      </>
    );
  }

  return (
    <>
      <AppModal
        open={item !== null}
        onCancel={onClose}
        size="md"
        eyebrow={
          item === null
            ? undefined
            : formatSnapshotTime(item.occurredAt) + " · " + actorName
        }
        title="原始快照"
      >
        <div className="snapshot-body" data-testid="activity-snapshot">
          {item === null ? null : body}
        </div>
      </AppModal>
    </>
  );
};

export default ActivitySnapshotModal;
