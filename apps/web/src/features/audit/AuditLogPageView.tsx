import React, { useCallback, useMemo, useState } from "react";
import { AppModal as Modal } from "@features/common/components/AppModal";
import type { AuditLogItem, InpulseApiClient } from "@generated/api";
import {
  CalmEmptyState,
  CalmSectionTitle,
} from "@features/common/components/Calm";
import { CalmSelect } from "@features/common/components/CalmSelect";
import { projectSelectOption } from "@features/common/project-select-option";
import { InpulseIcon } from "@features/common/components/InpulseIcon";
import { useProjects } from "@features/projects/project-query";
import { useUserDirectoryQuery } from "@features/users/user-directory-query";
import {
  AUDIT_ACTION_OPTIONS,
  auditActionLabel,
  auditActionWithCode,
  auditTargetTypeLabel,
  auditTargetTypeWithCode,
} from "./audit-labels";
import {
  AUDIT_PAGE_LIMIT,
  EMPTY_AUDIT_FILTERS,
  describeAuditError,
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

/** 快照里的完整本地时间（`2026-09-21 16:24:20`），原始 UTC 值由调用方放进 title。 */
function formatAuditDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  const date = [
    parsed.getFullYear(),
    String(parsed.getMonth() + 1).padStart(2, "0"),
    String(parsed.getDate()).padStart(2, "0"),
  ].join("-");
  const { time } = formatAuditTime(value);
  return date + " " + time;
}

/**
 * 「读取审计日志」是打开本页时自动生成的自我留痕：列表默认隐藏它们，
 * 但按该动作码精确筛选时视为显式查看意图，不再隐藏。
 */
const READ_TRAIL_ACTION = "AUDIT_LOG_READ";

function readText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * 事件载荷里的实体编号与名称：优先 after、其次 before，最后读平铺载荷
 * （演示种子数据是平铺结构）。读不到时由调用方回退到「类型 #id」。
 */
function payloadIdentity(item: AuditLogItem): {
  readonly code: string | null;
  readonly name: string | null;
} {
  for (const candidate of [
    item.eventPayload["after"],
    item.eventPayload["before"],
    item.eventPayload,
  ]) {
    if (typeof candidate !== "object" || candidate === null) {
      continue;
    }
    const source = candidate as Record<string, unknown>;
    const code = readText(source["code"]);
    const name = readText(source["name"]) ?? readText(source["title"]);
    if (code !== null || name !== null) {
      return { code, name };
    }
  }
  return { code: null, name: null };
}

/** 组合实体文案：`任务 INPULSE-T-64「单点登录」`，缺哪段就省哪段。 */
function entityLabel(
  typeLabel: string,
  identity: {
    readonly code: string | null;
    readonly name: string | null;
  },
): string {
  const head =
    identity.code === null ? typeLabel : typeLabel + " " + identity.code;
  return identity.name === null ? head : head + "「" + identity.name + "」";
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
  // 读取留痕按「查看」计数（ADR-042）：进入页面与切换审计链开启一次新查看，
  // 同一次查看内的重复请求、筛选、重置与重试不重复写 AUDIT_LOG_READ。
  const [newViewToken, setNewViewToken] = useState(0);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<AuditLogItem | null>(null);
  const [hideReadTrail, setHideReadTrail] = useState(true);

  const projectsQuery = useProjects(client ? { client } : {});
  const directoryQuery = useUserDirectoryQuery(client ? { client } : {});
  const auditQuery = useAuditLogsInfiniteQuery({
    chain,
    filters,
    newViewToken,
    ...(client ? { client } : {}),
  });

  const items = useMemo(
    () => auditQuery.data?.pages.flatMap((page) => [...page.items]) ?? [],
    [auditQuery.data],
  );
  const projects = projectsQuery.data?.items ?? [];
  const projectNames = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );
  const directoryNames = useMemo(
    () =>
      new Map(
        (directoryQuery.data ?? []).map((entry) => [entry.id, entry.name]),
      ),
    [directoryQuery.data],
  );

  const readTrailSuppressed =
    hideReadTrail && filters.action.trim() !== READ_TRAIL_ACTION;
  const visibleItems = useMemo(
    () =>
      readTrailSuppressed
        ? items.filter((item) => item.action !== READ_TRAIL_ACTION)
        : items,
    [items, readTrailSuppressed],
  );
  const hiddenReadTrailCount = items.length - visibleItems.length;

  const actorNameOf = useCallback(
    (item: AuditLogItem): string => {
      if (item.actorType === "SYSTEM") {
        return "系统";
      }
      if (item.actorId === null) {
        return "未知用户";
      }
      return directoryNames.get(item.actorId) ?? "用户 #" + item.actorId;
    },
    [directoryNames],
  );

  const actorAvatarOf = useCallback(
    (item: AuditLogItem): string => {
      if (item.actorType === "SYSTEM") {
        return "系";
      }
      if (item.actorId === null) {
        return "?";
      }
      const name = directoryNames.get(item.actorId);
      return name === undefined ? "U" + (item.actorId % 100) : name.slice(0, 1);
    },
    [directoryNames],
  );

  // 对象列尽量说人话：用户与项目按目录换成名字，业务实体优先用载荷里的
  // 编号与标题，读不到才退回原始数据库 ID。
  const targetLabelOf = useCallback(
    (item: AuditLogItem): string => {
      const typeLabel = auditTargetTypeLabel(item.targetType);
      if (item.targetId === null) {
        return typeLabel;
      }
      const numeric = Number(item.targetId);
      if (!Number.isSafeInteger(numeric) || numeric <= 0) {
        return typeLabel + " " + item.targetId;
      }
      if (item.targetType === "USER" || item.targetType === "PROJECT") {
        const name =
          item.targetType === "USER"
            ? directoryNames.get(numeric)
            : projectNames.get(numeric);
        if (name !== undefined) {
          return typeLabel + " " + name;
        }
      }
      const identity = payloadIdentity(item);
      if (identity.code !== null || identity.name !== null) {
        return entityLabel(typeLabel, identity);
      }
      return typeLabel + " #" + item.targetId;
    },
    [directoryNames, projectNames],
  );

  const scopeLabelOf = useCallback(
    (item: AuditLogItem): string =>
      item.projectId === null
        ? "系统链"
        : "项目 " + (projectNames.get(item.projectId) ?? "#" + item.projectId),
    [projectNames],
  );

  const chainLabelOf = useCallback(
    (item: AuditLogItem): string => {
      if (item.chainId === "SYSTEM") {
        return "SYSTEM 链";
      }
      const name =
        item.projectId === null
          ? null
          : (projectNames.get(item.projectId) ?? null);
      return "「" + (name ?? item.chainId) + "」项目链";
    },
    [projectNames],
  );

  const describeChain = useCallback(
    (value: AuditChain): string =>
      value.kind === "system"
        ? "SYSTEM 链"
        : "「" +
          (projectNames.get(value.projectId) ?? "项目 #" + value.projectId) +
          "」项目链",
    [projectNames],
  );

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
    // 筛选是同一次查看内的操作，不写新留痕（ADR-042）。
    setFilters(draftFilters);
  };

  const resetFilters = () => {
    setDraftFilters(EMPTY_AUDIT_FILTERS);
    setFilters(EMPTY_AUDIT_FILTERS);
    setFilterError(null);
  };

  const handleChainChange = (value: string) => {
    if (value === "system") {
      // 切换审计对象开启一次新查看：重新写读取留痕（ADR-042）。
      setNewViewToken((token) => token + 1);
      setChain({ kind: "system" });
      return;
    }
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && parsed > 0) {
      setNewViewToken((token) => token + 1);
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
        <button
          type="button"
          className="secondary-button"
          onClick={() => void auditQuery.refetch()}
        >
          重试
        </button>
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
        <div className="audit-trail-bar">
          <label className="check-line">
            <input
              type="checkbox"
              checked={hideReadTrail}
              onChange={(event) =>
                setHideReadTrail(event.currentTarget.checked)
              }
            />
            隐藏读取留痕
          </label>
          {hiddenReadTrailCount > 0 ? (
            <span>本页已隐藏 {hiddenReadTrailCount} 条读取留痕</span>
          ) : null}
        </div>
        {visibleItems.length === 0 ? (
          <CalmEmptyState
            icon="shield"
            title="本页记录均为读取留痕"
            description="读取留痕是打开本页时自动生成的记录；取消隐藏即可查看。"
          >
            <button
              type="button"
              className="secondary-button"
              onClick={() => setHideReadTrail(false)}
            >
              显示读取留痕
            </button>
          </CalmEmptyState>
        ) : (
          <div className="audit-list">
            {visibleItems.map((item) => {
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
                    <div className="activity-avatar">{actorAvatarOf(item)}</div>
                    <div>
                      <strong>
                        {actorNameOf(item)}
                        <span>{auditActionLabel(item.action)}</span>
                      </strong>
                      <p>对象：{targetLabelOf(item)}</p>
                      <small>
                        {"第 " +
                          item.sequenceNo +
                          " 条 · " +
                          scopeLabelOf(item)}
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
                      aria-label={"查看原始快照 第 " + item.sequenceNo + " 条"}
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
        )}
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
          <h1>动态审计</h1>
          <p>
            原始审计链仅系统管理员可读；打开本页或切换审计对象会在 SYSTEM
            链留下一条读取留痕，筛选与翻页不会重复留痕。
          </p>
        </div>
        <div className="catalog-actions activity-header-actions">
          <span className="activity-scope-badge">
            当前链：{activeChainLabel}
          </span>
          <span className="activity-admin-badge">管理员可查看原始快照</span>
        </div>
      </div>

      <div className="toolbar activity-toolbar audit-toolbar">
        <CalmSelect
          ariaLabel="审计链"
          value={chain.kind === "system" ? "system" : String(chain.projectId)}
          appearance="rich"
          onChange={(next) => handleChainChange(String(next))}
          options={[
            { value: "system", label: "SYSTEM 链（系统级）", iconText: "SY" },
            ...projects.map((project) => ({
              ...projectSelectOption(project),
              label: "PROJECT:" + project.id + " · " + project.name,
            })),
          ]}
        />
        <div className="task-search">
          <InpulseIcon name="search" size={16} />
          <input
            value={draftFilters.action}
            placeholder="动作：选择或输入原始动作码"
            aria-label="动作码"
            list="audit-action-options"
            onChange={(event) =>
              updateDraft({ action: event.currentTarget.value })
            }
          />
          <datalist id="audit-action-options">
            {AUDIT_ACTION_OPTIONS.map((option) => (
              <option
                key={option.code}
                value={option.code}
                label={option.label}
              />
            ))}
          </datalist>
        </div>
        <CalmSelect
          ariaLabel="操作人"
          appearance="member"
          multiple
          maxTagCount={1}
          width={200}
          value={draftFilters.actorIds}
          onChange={(next) =>
            updateDraft({ actorIds: next.map((value) => Number(value)) })
          }
          placeholder="全体操作人（可搜索多选）"
          loading={directoryQuery.isPending}
          options={(directoryQuery.data ?? []).map((entry) => ({
            value: entry.id,
            label: entry.name,
            avatarUrl: entry.avatarUrl ?? null,
            description: entry.isAdmin ? "系统管理员" : "项目成员",
          }))}
        />
        <label className="audit-time-field">
          <span>开始时间</span>
          <input
            type="datetime-local"
            value={draftFilters.from}
            aria-label="开始时间"
            onChange={(event) =>
              updateDraft({ from: event.currentTarget.value })
            }
          />
        </label>
        <label className="audit-time-field">
          <span>结束时间</span>
          <input
            type="datetime-local"
            value={draftFilters.to}
            aria-label="结束时间"
            onChange={(event) => updateDraft({ to: event.currentTarget.value })}
          />
        </label>
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
        每页 {AUDIT_PAGE_LIMIT} 条（契约默认值）；
        操作人不选即全体，可搜索多选； from / to 为半开区间 [from,
        to)，按浏览器本地时区换算为带时区时间；
        游标由服务端签名，不能跨查询复用。
      </p>

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
            打开本页或切换审计对象会向 SYSTEM
            链追加一条读取留痕（含筛选条件与返回条数，不含审计正文）；同一次查看内的筛选、重置与翻页不重复留痕，留痕失败则整体失败。
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
        eyebrow={
          snapshot === null
            ? undefined
            : formatAuditDateTime(snapshot.occurredAt) +
              " · " +
              actorNameOf(snapshot)
        }
        title="原始审计快照"
        onCancel={() => setSnapshot(null)}
        size="lg"
        className="snapshot-modal"
      >
        {snapshot ? (
          <div className="snapshot-body" data-testid="audit-snapshot">
            <section className="snapshot-group">
              <h3 className="snapshot-group-title">基本信息</h3>
              <dl className="calm-meta">
                <dt>链</dt>
                <dd>{chainLabelOf(snapshot)}</dd>
                <dt>链序号</dt>
                <dd>第 {snapshot.sequenceNo} 条</dd>
                <dt>操作</dt>
                <dd>{auditActionWithCode(snapshot.action)}</dd>
                <dt>对象</dt>
                <dd>{targetLabelOf(snapshot)}</dd>
                <dt>原始标识</dt>
                <dd>
                  {auditTargetTypeWithCode(snapshot.targetType) +
                    (snapshot.targetId === null
                      ? ""
                      : " · " + snapshot.targetId)}
                </dd>
                <dt>项目</dt>
                <dd>
                  {snapshot.projectId === null
                    ? "系统级（无项目）"
                    : (projectNames.get(snapshot.projectId) ??
                      "项目 #" + snapshot.projectId)}
                </dd>
                <dt>操作人</dt>
                <dd>{actorNameOf(snapshot)}</dd>
                <dt>时间</dt>
                <dd title={snapshot.occurredAt}>
                  {formatAuditDateTime(snapshot.occurredAt)}
                </dd>
              </dl>
            </section>
            <section className="snapshot-group">
              <h3 className="snapshot-group-title">请求上下文</h3>
              <dl className="calm-meta">
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
              </dl>
            </section>
            <section className="snapshot-group">
              <h3 className="snapshot-group-title">完整性校验</h3>
              <dl className="calm-meta">
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
            </section>
            <section className="snapshot-group">
              <h3 className="snapshot-group-title">事件载荷</h3>
              <pre data-testid="audit-snapshot-payload">
                {snapshotPayloadText(snapshot)}
              </pre>
            </section>
            <p className="permission-hint">
              <InpulseIcon name="shield" size={14} />
              审计日志不允许删除；原始快照仅系统管理员可见，读取本身已留痕。
            </p>
          </div>
        ) : null}
      </Modal>
    </div>
  );
};

export default AuditLogPageView;
