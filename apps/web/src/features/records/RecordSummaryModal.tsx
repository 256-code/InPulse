import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button } from "antd";
import type { InpulseApiClient, ProjectItem, UserRef } from "@generated/api";
import { AppModal } from "@features/common/components/AppModal";
import { CalmSegmented } from "@features/common/components/Calm";
import { CalmSelect } from "@features/common/components/CalmSelect";
import { InpulseIcon } from "@features/common/components/InpulseIcon";
import { projectSelectOption } from "@features/common/project-select-option";
import { PublishedRecordDetail } from "@features/published-records/PublishedRecordDetail";
import {
  buildSummaryDocument,
  summaryDocumentToText,
  type SummaryBlock,
} from "./record-summary-document";
import {
  useRecordSummaryQuery,
  type RecordSummaryGroupBy,
} from "./record-summary-query";
import "./record-summary.css";
import { CalmSkeleton } from "@features/common/components/CalmSkeleton";

/** 时间档位：自定义以外的三档都由本地日历推导起止自然日。 */
type RangePreset = "year" | "quarter" | "month" | "custom";

const RANGE_PRESETS: readonly {
  readonly value: RangePreset;
  readonly label: string;
}[] = [
  { value: "year", label: "本年" },
  { value: "quarter", label: "本季度" },
  { value: "month", label: "本月" },
  { value: "custom", label: "自定义" },
];

const pad = (value: number): string => String(value).padStart(2, "0");

const isoDay = (date: Date): string =>
  `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** 档位 → [起始日, 结束日]（含首尾，Asia/Shanghai 日历日）。 */
export function presetRange(preset: RangePreset): {
  readonly from: string;
  readonly to: string;
} {
  const now = new Date();
  const year = now.getFullYear();
  if (preset === "quarter") {
    const startMonth = Math.floor(now.getMonth() / 3) * 3;
    return {
      from: `${String(year)}-${pad(startMonth + 1)}-01`,
      to: isoDay(new Date(year, startMonth + 3, 0)),
    };
  }
  if (preset === "month") {
    const month = now.getMonth();
    return {
      from: `${String(year)}-${pad(month + 1)}-01`,
      to: isoDay(new Date(year, month + 1, 0)),
    };
  }
  return { from: `${String(year)}-01-01`, to: `${String(year)}-12-31` };
}

export interface RecordSummaryModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly client?: InpulseApiClient | undefined;
  /** 页头项目筛选的当前值；0 表示全部项目。打开弹窗时沿用。 */
  readonly defaultProjectId: number;
  readonly projects: readonly ProjectItem[];
}

/**
 * F-33 迭代总结弹窗：范围 → 服务端取事实 → 本地渲染正文。
 *
 * 弹窗只做取数与呈现，不写任何业务数据：不产生正式记录、不改任务状态，
 * 因此没有幂等、CSRF 与乐观锁语义。正文措辞由 record-summary-document.ts
 * 按事实推导，复制正文与该推导共用同一份文档模型，避免两处口径漂移。
 */
export function RecordSummaryModal({
  open,
  onClose,
  client,
  defaultProjectId,
  projects,
}: RecordSummaryModalProps) {
  const [preset, setPreset] = useState<RangePreset>("year");
  const [customRange, setCustomRange] = useState(() => presetRange("year"));
  const [projectId, setProjectId] = useState(defaultProjectId);
  const [groupBy, setGroupBy] = useState<RecordSummaryGroupBy>("PROJECT");
  const [memberId, setMemberId] = useState(0);
  const [memberOptions, setMemberOptions] = useState<readonly UserRef[]>([]);
  const [detail, setDetail] = useState(false);
  /** 明细里展开的那一条记录；null 表示全部收起（默认收起，点行或箭头展开）。 */
  const [expandedRecordId, setExpandedRecordId] = useState<number | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "done" | "failed">(
    "idle",
  );

  useEffect(() => {
    if (open) {
      setProjectId(defaultProjectId);
      setMemberId(0);
      setExpandedRecordId(null);
    }
  }, [open, defaultProjectId]);

  const toggleRecord = (recordId: number) => {
    setExpandedRecordId((current) => (current === recordId ? null : recordId));
  };

  const range = preset === "custom" ? customRange : presetRange(preset);
  const summary = useRecordSummaryQuery({
    client,
    from: range.from,
    to: range.to,
    groupBy,
    projectId,
    memberId,
    enabled: open,
  });

  const document = useMemo(
    () =>
      summary.data === undefined ? null : buildSummaryDocument(summary.data),
    [summary.data],
  );

  // 成员候选只来自同口径的按成员总结，避免为此新增成员目录接口。
  useEffect(() => {
    const data = summary.data;
    if (data === undefined || data.groupBy !== "MEMBER") return;
    const seen = new Set<number>();
    const next: UserRef[] = [];
    for (const section of data.sections) {
      if (section.member === null || seen.has(section.member.userId)) continue;
      seen.add(section.member.userId);
      next.push(section.member);
    }
    if (next.length > 0) setMemberOptions(next);
  }, [summary.data]);

  const copy = useCallback(async () => {
    if (document === null) return;
    try {
      await navigator.clipboard.writeText(summaryDocumentToText(document));
      setCopyState("done");
    } catch {
      setCopyState("failed");
    }
    window.setTimeout(() => setCopyState("idle"), 2000);
  }, [document]);

  const filters = (
    <div className="summary-filters">
      <div className="summary-filter-row">
        <span className="summary-filter-label">时间</span>
        <CalmSegmented
          label="时间范围"
          value={preset}
          options={RANGE_PRESETS.map((option) => ({
            value: option.value,
            label: option.label,
          }))}
          onChange={(next) => setPreset(next as RangePreset)}
        />
        {preset === "custom" ? (
          <span className="summary-range-inputs">
            <input
              type="date"
              aria-label="起始日期"
              value={customRange.from}
              onChange={(event) =>
                setCustomRange((prev) => ({
                  ...prev,
                  from: event.target.value,
                }))
              }
            />
            <input
              type="date"
              aria-label="结束日期"
              value={customRange.to}
              onChange={(event) =>
                setCustomRange((prev) => ({ ...prev, to: event.target.value }))
              }
            />
          </span>
        ) : (
          <span className="summary-range-text">
            {range.from} - {range.to}
          </span>
        )}
      </div>
      <div className="summary-filter-row">
        <span className="summary-filter-label">项目</span>
        <CalmSelect
          ariaLabel="总结项目"
          value={projectId > 0 ? String(projectId) : ""}
          appearance="rich"
          onChange={(next) => setProjectId(Number(next) || 0)}
          options={[
            { value: "", label: "全部项目" },
            ...projects.map(projectSelectOption),
          ]}
        />
      </div>
      <div className="summary-filter-row">
        <span className="summary-filter-label">归纳</span>
        <CalmSegmented
          label="归纳方式"
          value={groupBy}
          options={[
            { value: "PROJECT", label: "按项目" },
            { value: "MEMBER", label: "按成员" },
          ]}
          onChange={(next) => {
            setGroupBy(next as RecordSummaryGroupBy);
            setMemberId(0);
          }}
        />
        {groupBy === "MEMBER" && memberOptions.length > 0 ? (
          <CalmSelect
            ariaLabel="总结成员"
            value={memberId > 0 ? String(memberId) : ""}
            appearance="menu"
            onChange={(next) => setMemberId(Number(next) || 0)}
            options={[
              { value: "", label: "全体成员" },
              ...memberOptions.map((member) => ({
                value: String(member.userId),
                label: member.name,
              })),
            ]}
          />
        ) : null}
      </div>
    </div>
  );

  const renderBlock = (block: SummaryBlock, index: number) => {
    if (block.kind === "overview") {
      return (
        <p className="summary-overview" key={index}>
          <b>整体概览</b>
          {"　"}
          {block.text}
        </p>
      );
    }
    if (block.kind === "section") {
      return (
        <section className="summary-section" key={index}>
          <h4>{block.heading}</h4>
          {block.bullets.length === 0 ? (
            <p className="summary-empty">本范围内没有已发布的迭代记录。</p>
          ) : (
            <ul>
              {block.bullets.map((bullet, bulletIndex) => (
                <li key={bulletIndex}>
                  <b>{bullet.label}</b>
                  {"："}
                  {bullet.text}
                </li>
              ))}
            </ul>
          )}
        </section>
      );
    }
    return (
      <section className="summary-section" key={index}>
        <h4>{block.heading}</h4>
        <p>{block.lead}</p>
        {block.items.length === 0 ? (
          <p className="summary-empty">没有待跟进条目。</p>
        ) : (
          <ul>
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>{item}</li>
            ))}
          </ul>
        )}
      </section>
    );
  };

  const data = summary.data;
  const body = summary.isPending ? (
    <CalmSkeleton variant="lines" rows={6} label="正在生成总结" />
  ) : summary.isError ? (
    <Alert
      type="error"
      title="生成总结失败，请重试。"
      action={<Button onClick={() => void summary.refetch()}>重试</Button>}
    />
  ) : detail && data !== undefined ? (
    <div className="summary-detail">
      <div className="summary-stat-grid">
        <div>
          <span>迭代记录</span>
          <strong>{data.totals.recordCount}</strong>
        </div>
        <div>
          <span>已完成任务</span>
          <strong>{data.totals.completedTaskCount}</strong>
        </div>
        <div>
          <span>涉及项目 / 模块 / 功能</span>
          <strong>
            {data.totals.projectCount} / {data.totals.moduleCount} /{" "}
            {data.totals.featureCount}
          </strong>
        </div>
        <div>
          <span>遗留问题（待跟进）</span>
          <strong>
            {data.totals.leftoverCount}（
            {data.totals.leftoverCount - data.totals.closedLeftoverCount}）
          </strong>
        </div>
        <div>
          <span>缺口任务</span>
          <strong>{data.totals.missingRecordTaskCount}</strong>
        </div>
      </div>
      <table className="summary-detail-table">
        <thead>
          <tr>
            <th className="summary-detail-toggle-head" aria-label="展开详情" />
            <th>编号</th>
            <th>项目 / 模块 / 功能</th>
            <th>标题与效果</th>
            <th>作者</th>
            <th>发布日</th>
          </tr>
        </thead>
        <tbody>
          {data.points.map((point) => {
            const expanded = expandedRecordId === point.recordId;
            return (
              <React.Fragment key={point.recordId}>
                {/*
                  整行可点：总结明细用于核对取数，展开即读记录正文的三段完整文本
                  与遗留问题（正文比要点里的效果句长得多，要点被折叠并截断到 1000 字）。
                */}
                <tr
                  className={
                    expanded
                      ? "summary-detail-row is-expanded"
                      : "summary-detail-row"
                  }
                  onClick={() => {
                    toggleRecord(point.recordId);
                  }}
                >
                  <td className="summary-detail-toggle">
                    <button
                      type="button"
                      className="summary-detail-toggle-button"
                      aria-expanded={expanded}
                      aria-label={
                        expanded
                          ? `收起 ${point.recordCode} 的详细内容`
                          : `展开 ${point.recordCode} 的详细内容`
                      }
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleRecord(point.recordId);
                      }}
                    >
                      <InpulseIcon
                        name="chevron"
                        size={14}
                        {...(expanded ? { className: "expanded" } : {})}
                      />
                    </button>
                  </td>
                  <td>{point.recordCode}</td>
                  <td>
                    {point.projectName} / {point.moduleName}
                    {point.featureName === null
                      ? ""
                      : ` / ${point.featureName}`}
                  </td>
                  <td>
                    <b>{point.title}</b>
                    <small>{point.detail}</small>
                  </td>
                  <td>{point.author.name}</td>
                  <td>{point.publishedAt.slice(0, 10)}</td>
                </tr>
                {expanded ? (
                  <tr className="summary-detail-expanded">
                    <td colSpan={6}>
                      {/*
                        只读复用正式记录详情（B-3a）：同一查询键
                        ["published-record", projectId, recordId]，详情已加载过时命中缓存，
                        只读形态不发版本、GitHub 与任何写入请求。
                      */}
                      <PublishedRecordDetail
                        projectId={point.projectId}
                        recordId={point.recordId}
                        client={client}
                        writable={false}
                        readOnly
                      />
                    </td>
                  </tr>
                ) : null}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  ) : document === null ? null : (
    <article className="summary-doc">
      <h3>{document.title}</h3>
      <p className="summary-scope">{document.scopeLine}</p>
      {document.blocks.map(renderBlock)}
      <p className="summary-note">{document.note}</p>
    </article>
  );

  return (
    <AppModal
      open={open}
      onCancel={onClose}
      size="xl"
      title="生成总结"
      closeLabel="关闭生成总结"
      className="record-summary-modal"
    >
      <div className="summary-shell">
        {filters}
        <div className="summary-scroll">{body}</div>
      </div>
      <div className="calm-action-footer">
        <span className="footer-leading summary-footer-count">
          {data === undefined
            ? summary.isError
              ? "取数失败"
              : "正在取数"
            : `${detail ? "明细" : "已归纳"} ${String(data.totals.recordCount)} 条迭代记录`}
        </span>
        <Button
          onClick={() => setDetail((prev) => !prev)}
          disabled={data === undefined}
        >
          {detail ? "返回总结" : "查看明细"}
        </Button>
        <Button
          onClick={() => void summary.refetch()}
          loading={summary.isFetching}
        >
          重新生成
        </Button>
        <Button
          type="primary"
          disabled={document === null}
          onClick={() => void copy()}
        >
          {copyState === "done"
            ? "已复制"
            : copyState === "failed"
              ? "复制失败"
              : detail
                ? "复制明细 Markdown"
                : "复制正文"}
        </Button>
      </div>
    </AppModal>
  );
}
