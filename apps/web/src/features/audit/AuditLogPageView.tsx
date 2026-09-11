import React, { useEffect, useMemo, useState } from "react";
import { Modal } from "antd";
import type { AuditLogItem, InpulseApiClient } from "@generated/api";
import { AdminReauthenticateModal } from "@features/auth/AdminReauthenticateModal";
import {
  CalmEmptyState,
  CalmSectionTitle,
} from "@features/common/components/Calm";
import { InpulseIcon } from "@features/common/components/InpulseIcon";
import { useProjects } from "@features/projects/project-query";
import {
  AUDIT_PAGE_LIMIT,
  EMPTY_AUDIT_FILTERS,
  describeAuditError,
  isAdminReauthRequired,
  useAuditLogsInfiniteQuery,
  validateAuditFilters,
  type AuditChain,
  type AuditFilters,
} from "./audit-query";

export interface AuditLogPageViewProps {
  readonly client?: InpulseApiClient | undefined;
}

function formatAuditTime(value: string): { date: string; time: string } {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return { date: value, time: "" };
  }
  const date = [
    String(parsed.getMonth() + 1).padStart(2, "0"),
    String(parsed.getDate()).padStart(2, "0"),
  ].join("-");
  const time = [
    String(parsed.getHours()).padStart(2, "0"),
    String(parsed.getMinutes()).padStart(2, "0"),
    String(parsed.getSeconds()).padStart(2, "0"),
  ].join(":");
  return { date, time };
}

function actorLabel(item: AuditLogItem): string {
  if (item.actorType === "SYSTEM") {
    return "系统";
  }
  return item.actorId === null ? "未知用户" : "用户 #" + item.actorId;
}

function actorAvatar(item: AuditLogItem): string {
  if (item.actorType === "SYSTEM") {
    return "系";
  }
  return item.actorId === null ? "?" : "U" + (item.actorId % 100);
}

function describeChain(chain: AuditChain): string {
  return chain.kind === "system"
    ? "SYSTEM 链"
    : "PROJECT:" + chain.projectId + " 链";
}

function snapshotPayloadText(item: AuditLogItem): string {
  try {
    return JSON.stringify(item.eventPayload, null, 2);
  } catch {
    return "事件载荷无法序列化";
  }
}

export const AuditLogPageView: React.FC<AuditLogPageViewProps> = ({
  client,
}) => {
  const [chain, setChain] = useState<AuditChain>({ kind: "system" });
  const [draftFilters, setDraftFilters] =
    useState<AuditFilters>(EMPTY_AUDIT_FILTERS);
  const [filters, setFilters] = useState<AuditFilters>(EMPTY_AUDIT_FILTERS);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<AuditLogItem | null>(null);
  const [reauthOpen, setReauthOpen] = useState(false);
  const [reauthReady, setReauthReady] = useState(false);

  const projectsQuery = useProjects(client ? { client } : {});
  const auditQuery = useAuditLogsInfiniteQuery({
    chain,
    filters,
    ...(client ? { client } : {}),
  });

  const items = useMemo(
    () => auditQuery.data?.pages.flatMap((page) => [...page.items]) ?? [],
    [auditQuery.data],
  );
  const projects = projectsQuery.data?.items ?? [];

  useEffect(() => {
    if (auditQuery.isError && isAdminReauthRequired(auditQuery.error)) {
      setReauthOpen(true);
    }
  }, [auditQuery.error, auditQuery.isError]);

  const updateDraft = (patch: Partial<AuditFilters>) => {
    setDraftFilters((current) => ({ ...current, ...patch }));
  };

  const applyFilters = () => {
    const invalid = validateAuditFilters(draftFilters);
    if (invalid !== null) {
      setFilterError(invalid);
      return;
    }
    setFilterError(null);
    setFilters(draftFilters);
  };

  const resetFilters = () => {
    setDraftFilters(EMPTY_AUDIT_FILTERS);
    setFilters(EMPTY_AUDIT_FILTERS);
    setFilterError(null);
  };

  const handleChainChange = (value: string) => {
    if (value === "system") {
      setChain({ kind: "system" });
      return;
    }
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && parsed > 0) {
      setChain({ kind: "project", projectId: parsed });
    }
  };

  const activeChainLabel = describeChain(chain);

  let content: React.ReactNode;
  if (auditQuery.isPending) {
    content = (
      <div className="activity-state">
        <span className="activity-spinner" />
        正在读取原始审计链...
      </div>
    );
  } else if (auditQuery.isError) {
    content = (
      <CalmEmptyState
        icon="alert"
        title="原始审计读取失败"
        description={describeAuditError(auditQuery.error)}
      >
        {isAdminReauthRequired(auditQuery.error) ? (
          <button
            type="button"
            className="secondary-button"
            onClick={() => setReauthOpen(true)}
          >
            完成管理员安全验证
          </button>
        ) : (
          <button
            type="button"
            className="secondary-button"
            onClick={() => void auditQuery.refetch()}
          >
            重试
          </button>
        )}
      </CalmEmptyState>
    );
  } else if (items.length === 0) {
    content = (
      <CalmEmptyState
        icon="shield"
        title="没有匹配的审计记录"
        description="调整筛选条件，或切换审计链后重试。"
      >
        <button
          type="button"
          className="secondary-button"
          onClick={resetFilters}
        >
          清除筛选
        </button>
      </CalmEmptyState>
    );
  } else {
    content = (
      <>
        <div className="audit-list">
          {items.map((item) => {
            const time = formatAuditTime(item.occurredAt);
            const rowKey = item.chainId + "-" + item.sequenceNo;
            return (
              <div
                className="audit-row"
                key={rowKey}
                data-testid={"audit-item-" + rowKey}
              >
                <div className="audit-time">
                  {time.date}
                  <small>{time.time}</small>
                </div>
                <div className="audit-line">
                  <span />
                </div>
                <div className="audit-content">
                  <div className="activity-avatar">{actorAvatar(item)}</div>
                  <div>
                    <strong>
                      {actorLabel(item)}
                      <span>{item.action}</span>
                    </strong>
                    <p>
                      {item.targetType}
                      {item.targetId === null ? "" : " #" + item.targetId}
                    </p>
                    <small>
                      {"链 " +
                        item.chainId +
                        " · 序号 " +
                        item.sequenceNo +
                        " · " +
                        (item.projectId === null
                          ? "系统级"
                          : "项目 #" + item.projectId)}
                    </small>
                  </div>
                </div>
                <div className="audit-actions">
                  <span className="audit-entity-badge">
                    {item.actorType === "SYSTEM" ? "系统操作" : "用户操作"}
                  </span>
                  <button
                    type="button"
                    className="secondary-button"
                    aria-label={"查看原始快照 序号 " + item.sequenceNo}
                    onClick={() => setSnapshot(item)}
                  >
                    <InpulseIcon name="shield" size={13} />
                    原始快照
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        {auditQuery.hasNextPage ? (
          <button
            type="button"
            className="secondary-button activity-load-more"
            disabled={auditQuery.isFetchingNextPage}
            onClick={() => void auditQuery.fetchNextPage()}
          >
            {auditQuery.isFetchingNextPage ? "正在加载..." : "加载更多"}
          </button>
        ) : null}
      </>
    );
  }

  return (
    <div className="activity-page">
      <div className="page-header activity-page-header">
        <div>
          <span className="eyebrow">动态与审计 · F-08</span>
          <h1>动态审计</h1>
          <p>
            原始审计链仅系统管理员可读，需要 5 分钟内的管理员密码 + TOTP
            重认证；每次读取都会向 SYSTEM 链写入 AUDIT_LOG_READ 留痕。
          </p>
        </div>
        <div className="catalog-actions activity-header-actions">
          <span className="activity-scope-badge">
            当前链：{activeChainLabel}
          </span>
          <span className="activity-admin-badge">管理员可查看原始快照</span>
        </div>
      </div>

      <div className="toolbar task-toolbar activity-toolbar audit-toolbar">
        <select
          aria-label="审计链"
          value={chain.kind === "system" ? "system" : String(chain.projectId)}
          onChange={(event) => handleChainChange(event.currentTarget.value)}
        >
          <option value="system">SYSTEM 链（系统级）</option>
          {projects.map((project) => (
            <option key={project.id} value={String(project.id)}>
              {"PROJECT:" + project.id + " · " + project.name}
            </option>
          ))}
        </select>
        <div className="task-search">
          <InpulseIcon name="search" size={16} />
          <input
            value={draftFilters.action}
            placeholder="动作码（精确匹配，如 project.create）"
            aria-label="动作码"
            onChange={(event) =>
              updateDraft({ action: event.currentTarget.value })
            }
          />
        </div>
        <input
          type="number"
          min={1}
          value={draftFilters.actorId}
          placeholder="操作人 ID"
          aria-label="操作人 ID"
          onChange={(event) =>
            updateDraft({ actorId: event.currentTarget.value })
          }
        />
        <input
          type="datetime-local"
          value={draftFilters.from}
          aria-label="开始时间"
          onChange={(event) => updateDraft({ from: event.currentTarget.value })}
        />
        <input
          type="datetime-local"
          value={draftFilters.to}
          aria-label="结束时间"
          onChange={(event) => updateDraft({ to: event.currentTarget.value })}
        />
        <button
          type="button"
          className="secondary-button"
          onClick={applyFilters}
        >
          查询
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={resetFilters}
        >
          重置
        </button>
      </div>

      <p className="permission-hint">
        <InpulseIcon name="shield" size={14} />
        每页 {AUDIT_PAGE_LIMIT} 条（契约默认值）； from / to 为半开区间 [from,
        to)，按浏览器本地时区换算为带时区时间；
        游标由服务端签名，不能跨查询复用。
      </p>

      {reauthReady ? (
        <div className="permission-note note-success" role="status">
          <InpulseIcon name="check" size={16} />
          <span>管理员安全验证已完成，正在重新读取原始审计。</span>
        </div>
      ) : null}

      {filterError ? (
        <div className="permission-note note-warning" role="alert">
          <InpulseIcon name="alert" size={16} />
          <span>{filterError}</span>
        </div>
      ) : null}

      {content}

      <section className="activity-rules">
        <CalmSectionTitle title="审计规则" hint="BR-012 · 原始审计只追加" />
        <ul className="rule-list">
          <li>
            <strong>只追加</strong>
            审计链不可编辑、不可删除；修正历史只能通过新事件或版本恢复完成。
          </li>
          <li>
            <strong>留痕</strong>
            每次读取都会向 SYSTEM 链写入
            AUDIT_LOG_READ（含筛选条件与返回条数，不含审计正文），留痕失败则整体失败。
          </li>
          <li>
            <strong>范围</strong>
            不选择项目时读取 SYSTEM 链，选择项目时读取对应 PROJECT
            链，不跨链返回。
          </li>
        </ul>
      </section>

      <Modal
        open={snapshot !== null}
        title="原始审计快照"
        onCancel={() => setSnapshot(null)}
        footer={null}
        width={720}
        className="catalog-modal"
      >
        {snapshot ? (
          <div className="snapshot-body" data-testid="audit-snapshot">
            <dl className="calm-meta">
              <dt>链</dt>
              <dd>{snapshot.chainId}</dd>
              <dt>链序号</dt>
              <dd>{snapshot.sequenceNo}</dd>
              <dt>操作</dt>
              <dd>{snapshot.action}</dd>
              <dt>对象类型</dt>
              <dd>{snapshot.targetType}</dd>
              <dt>对象 ID</dt>
              <dd>{snapshot.targetId ?? "—"}</dd>
              <dt>项目</dt>
              <dd>
                {snapshot.projectId === null
                  ? "系统级（无项目）"
                  : "#" + snapshot.projectId}
              </dd>
              <dt>操作人</dt>
              <dd>{actorLabel(snapshot)}</dd>
              <dt>时间</dt>
              <dd>{snapshot.occurredAt}</dd>
              <dt>请求 ID</dt>
              <dd>
                <code>{snapshot.requestId}</code>
              </dd>
              <dt>客户端请求 ID</dt>
              <dd>{snapshot.clientRequestId ?? "—"}</dd>
              <dt>IP 地址</dt>
              <dd>{snapshot.ipAddress ?? "—"}</dd>
              <dt>User-Agent</dt>
              <dd>{snapshot.userAgent ?? "—"}</dd>
              <dt>密钥版本</dt>
              <dd>{snapshot.keyVersion}</dd>
              <dt>规范化版本</dt>
              <dd>{snapshot.canonicalVersion}</dd>
              <dt>前一条哈希</dt>
              <dd>
                <code>{snapshot.prevHash}</code>
              </dd>
              <dt>本条哈希</dt>
              <dd>
                <code>{snapshot.recordHash}</code>
              </dd>
            </dl>
            <h3>事件载荷</h3>
            <pre data-testid="audit-snapshot-payload">
              {snapshotPayloadText(snapshot)}
            </pre>
            <p className="permission-hint">
              <InpulseIcon name="shield" size={14} />
              审计日志不允许删除；原始快照仅系统管理员可见，读取本身已留痕。
            </p>
          </div>
        ) : null}
      </Modal>

      <AdminReauthenticateModal
        open={reauthOpen}
        onClose={() => setReauthOpen(false)}
        onSuccess={() => {
          setReauthOpen(false);
          setReauthReady(true);
          void auditQuery.refetch();
        }}
      />
    </div>
  );
};

export default AuditLogPageView;
