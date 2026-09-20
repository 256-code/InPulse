import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Spin } from "antd";
import { InpulseIcon } from "@features/common/components/InpulseIcon";
import { createApiClient, type InpulseApiClient } from "@generated/api";
import {
  CalmEmptyState,
  CalmSegmented,
} from "@features/common/components/Calm";
import { CalmSelect } from "@features/common/components/CalmSelect";
import { projectSelectOption } from "@features/common/project-select-option";
import { useAuth } from "@features/auth/auth-context";
import { useScopedSearchParams } from "@features/common/search-params-scope";
import { RecordDraftsView } from "@features/record-drafts/RecordDraftsView";
import {
  useRecordFeedQuery,
  type RecordFeedStatus,
} from "@features/published-records/published-records-query";
import {
  PublishedRecordDetail,
  publishedRecordErrorMessage,
} from "@features/published-records/PublishedRecordDetail";
import { PublishedRecordCard } from "./PublishedRecordCard";
import { useProjectFeatureNames } from "./feature-name-map";
import {
  groupRecordsByDate,
  RECORD_SEARCH_PLACEHOLDER,
  RECORD_SOURCE_FILTERS,
  timelineDayLabel,
  timelineTimeLabel,
  type RecordSourceFilter,
} from "./record-timeline";
import "./records-timeline.css";

/** 关键词下发前的防抖窗口（毫秒）：与相似功能提示保持同一节奏。 */
const SEARCH_DEBOUNCE_MS = 350;

/**
 * B-3a：`/records` 单页工作区（设计师稿 views/records.tsx 的结构）。
 * B-3b：项目下拉增加「全部项目」并作为默认视图（跨项目记录清单 + 名称回填），
 * 来源五档与关键词 `q` 改为服务端筛选，我的草稿条带改为全局 `listMyRecordDrafts`；
 * 页头 CTA → 我的草稿条带 → 项目草稿与草稿详情 → 筛选 toolbar → 按发布日分组。
 * 「全部项目」下 CTA 仍可用：草稿按项目 + 模块创建，目标项目在弹窗内选定；
 * URL 已选项目时弹窗直接沿用该项目。
 */
export function RecordsWorkspace({
  client,
  embedded = false,
}: {
  readonly client?: InpulseApiClient | undefined;
  /** 嵌在项目主页弹窗内：标题由弹层头部承担，页头只保留 CTA。 */
  readonly embedded?: boolean | undefined;
}) {
  const api = useMemo(() => client ?? createApiClient(), [client]);
  const { user } = useAuth();
  // 整页用路由搜索参数；装进项目主页弹窗时用作用域内的本地状态。
  const [params, setParams] = useScopedSearchParams();
  const projectId = Number(params.get("projectId")) || 0;
  const publishedId = Number(params.get("publishedId")) || 0;
  const requestedStatus = params.get("status");
  const status: RecordFeedStatus =
    user?.isAdmin && (requestedStatus === "VOID" || requestedStatus === "ALL")
      ? requestedStatus
      : "PUBLISHED";
  const [query, setQuery] = useState("");
  const [term, setTerm] = useState("");
  const [source, setSource] = useState<RecordSourceFilter>("ALL");
  const [createToken, setCreateToken] = useState(0);
  const [canCreate, setCanCreate] = useState(false);
  /** 时间线按天折叠：记录日期键集合，默认全部展开。 */
  const [collapsedDays, setCollapsedDays] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const toggleDay = (key: string) =>
    setCollapsedDays((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const featureNames = useProjectFeatureNames(projectId, client);
  useEffect(() => {
    const timer = window.setTimeout(
      () => setTerm(query.trim()),
      SEARCH_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [query]);
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: ({ signal }) => api.listProjects({ signal }),
    retry: false,
  });
  const list = useRecordFeedQuery({
    client,
    projectId,
    status,
    source,
    query: term,
  });
  const items = list.data?.pages.flatMap((page) => [...page.items]) ?? [];
  const groups = groupRecordsByDate(items);
  const projectStatus = useMemo(
    () =>
      new Map(
        (projects.data?.items ?? []).map(
          (item) => [item.id, item.status] as const,
        ),
      ),
    [projects.data],
  );
  /** 跨项目视图下每条记录按自身项目的状态判定可写，避免误用当前所选项目。 */
  const canWrite = (recordProjectId: number) => {
    // ADR-035：项目四态下只有已归档只读；列表里没有该项目时按只读处理。
    const status = projectStatus.get(recordProjectId);
    return status !== undefined && status !== "ARCHIVED";
  };
  const reportCanCreate = useCallback((next: boolean) => {
    setCanCreate((prev) => (prev === next ? prev : next));
  }, []);
  const filtered = term.length > 0 || source !== "ALL";
  const standaloneDetail =
    projectId > 0 &&
    publishedId > 0 &&
    !list.isPending &&
    !items.some((item) => item.record.id === publishedId);
  const selectProject = (value: string) => {
    const next = new URLSearchParams(params);
    if (Number(value) > 0) next.set("projectId", value);
    else next.delete("projectId");
    next.delete("publishedId");
    next.delete("recordId");
    setParams(next);
  };
  const selectStatus = (next: RecordFeedStatus) => {
    const nextParams = new URLSearchParams(params);
    if (next === "PUBLISHED") nextParams.delete("status");
    else nextParams.set("status", next);
    nextParams.delete("publishedId");
    setParams(nextParams);
  };
  const toggleRecord = (id: number, open: boolean) => {
    const nextParams = new URLSearchParams(params);
    if (open && Number(nextParams.get("publishedId")) !== id)
      nextParams.set("publishedId", String(id));
    else if (!open && Number(nextParams.get("publishedId")) === id)
      nextParams.delete("publishedId");
    else return;
    setParams(nextParams, { replace: true });
  };
  return (
    <div className="records-workspace">
      <div className={"page-header" + (embedded ? " embedded" : "")}>
        {embedded ? null : (
          <div>
            <h1>迭代记录</h1>
            <p>
              只记录已经发生或已确认的变化。人员、时间、归属与版本全部自动生成。
            </p>
          </div>
        )}
        <button
          type="button"
          className="primary-button"
          disabled={!canCreate}
          title={
            canCreate
              ? undefined
              : projectId === 0
                ? "当前没有可写入的项目"
                : "请先选择项目"
          }
          onClick={() => setCreateToken((token) => token + 1)}
        >
          <InpulseIcon name="plus" size={16} />
          记录一次迭代
        </button>
      </div>
      <div className="record-drafts-block">
        <RecordDraftsView
          client={client}
          createToken={createToken}
          currentUserId={user?.id}
          onCanCreateChange={reportCanCreate}
        />
      </div>
      <div className="toolbar task-toolbar records-toolbar">
        <div className="task-search">
          <InpulseIcon name="search" size={16} />
          <input
            value={query}
            placeholder={RECORD_SEARCH_PLACEHOLDER}
            aria-label="搜索迭代记录"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {embedded ? null : (
          <label className="records-toolbar-field">
            项目
            <CalmSelect
              ariaLabel="项目"
              value={projectId > 0 ? String(projectId) : ""}
              onChange={(next) => selectProject(String(next))}
              appearance="rich"
              options={[
                { value: "", label: "全部项目" },
                ...(projects.data?.items ?? []).map(projectSelectOption),
              ]}
            />
          </label>
        )}
        <label className="records-toolbar-field">
          来源
          <CalmSelect
            ariaLabel="来源"
            value={source}
            appearance="menu"
            onChange={(next) => setSource(next as RecordSourceFilter)}
            options={RECORD_SOURCE_FILTERS.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
          />
        </label>
        <CalmSegmented
          label="记录状态"
          value={status}
          options={
            user?.isAdmin
              ? [
                  { value: "PUBLISHED", label: "已发布" },
                  { value: "VOID", label: "已作废" },
                  { value: "ALL", label: "全部" },
                ]
              : [{ value: "PUBLISHED", label: "已发布" }]
          }
          onChange={selectStatus}
        />
      </div>
      {projects.isError && (
        <Alert
          type="error"
          title="项目列表加载失败，请重试。"
          action={
            <Button onClick={() => void projects.refetch()}>重试项目</Button>
          }
        />
      )}
      {list.isPending ? (
        <Spin />
      ) : list.isError ? (
        <Alert
          type="error"
          title={publishedRecordErrorMessage(list.error)}
          action={
            <Button onClick={() => void list.refetch()}>重试记录列表</Button>
          }
        />
      ) : !items.length ? (
        <CalmEmptyState
          icon="gitBranch"
          title={
            filtered
              ? "没有匹配的迭代记录"
              : status === "VOID"
                ? "暂无已作废记录"
                : "暂无已发布记录"
          }
          description={
            filtered
              ? "调整筛选条件，或直接在功能档案中记录一次已经发生的变化。"
              : "草稿发布后会出现在这里。"
          }
        />
      ) : (
        <div className="record-timeline">
          {groups.map((group) => {
            const collapsed =
              collapsedDays.has(group.key) &&
              !group.records.some((item) => item.record.id === publishedId);
            return (
              <section className="timeline-block" key={group.key}>
                <span aria-hidden="true" className="timeline-day">
                  {timelineDayLabel(group.key)}
                </span>
                <button
                  type="button"
                  className="timeline-toggle"
                  aria-expanded={!collapsed}
                  onClick={() => toggleDay(group.key)}
                >
                  <InpulseIcon
                    name="chevron"
                    size={14}
                    {...(collapsed ? {} : { className: "expanded" })}
                  />
                  <strong>{group.label}</strong>
                  <small>{group.records.length} 条</small>
                </button>
                {!collapsed && (
                  <div className="record-card-list">
                    {group.records.map((item) => (
                      <div className="timeline-item" key={item.record.id}>
                        <span aria-hidden="true" className="timeline-time">
                          {timelineTimeLabel(item.record.publishedAt)}
                        </span>
                        <PublishedRecordCard
                          item={item}
                          client={client}
                          writable={canWrite(item.record.projectId)}
                          open={publishedId === item.record.id}
                          onToggle={(open) =>
                            toggleRecord(item.record.id, open)
                          }
                          onListChanged={() => void list.refetch()}
                          featureNames={featureNames}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
      {standaloneDetail && (
        <section className="record-standalone-detail">
          <PublishedRecordDetail
            projectId={projectId}
            recordId={publishedId}
            client={client}
            writable={canWrite(projectId)}
            standalone
            onListChanged={() => void list.refetch()}
          />
        </section>
      )}
      {list.hasNextPage && (
        <div className="record-load-more">
          <Button
            disabled={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            {list.isFetchingNextPage ? "正在加载…" : "加载更多"}
          </Button>
        </div>
      )}
    </div>
  );
}
