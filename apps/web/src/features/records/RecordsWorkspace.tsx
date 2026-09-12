import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Spin } from "antd";
import { InpulseIcon } from "@features/common/components/InpulseIcon";
import { createApiClient, type InpulseApiClient } from "@generated/api";
import {
  CalmEmptyState,
  CalmSegmented,
} from "@features/common/components/Calm";
import { useAuth } from "@features/auth/auth-context";
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
import {
  groupRecordsByDate,
  RECORD_SEARCH_PLACEHOLDER,
  RECORD_SOURCE_FILTERS,
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
 * 创建草稿仍要求先选定具体项目（草稿按项目 + 模块创建，服务端不接受「全部项目」）。
 */
export function RecordsWorkspace({
  client,
}: {
  readonly client?: InpulseApiClient | undefined;
}) {
  const api = useMemo(() => client ?? createApiClient(), [client]);
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
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
  const canWrite = (recordProjectId: number) =>
    projectStatus.get(recordProjectId) === "ACTIVE";
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
      <div className="page-header">
        <div>
          <div className="eyebrow">研发记录 / {items.length} 条</div>
          <h1>迭代记录</h1>
          <p>
            只记录已经发生或已确认的变化。人员、时间、归属与版本全部自动生成。
          </p>
        </div>
        <button
          type="button"
          className="primary-button"
          disabled={projectId === 0 || !canCreate}
          title={projectId === 0 ? "请先选择项目" : undefined}
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
        <label className="records-toolbar-field">
          项目
          <select
            aria-label="项目"
            value={projectId > 0 ? String(projectId) : ""}
            onChange={(event) => selectProject(event.target.value)}
          >
            <option value="">全部项目</option>
            {projects.data?.items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="records-toolbar-field">
          来源
          <select
            aria-label="来源"
            value={source}
            onChange={(event) =>
              setSource(event.target.value as RecordSourceFilter)
            }
          >
            {RECORD_SOURCE_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
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
        groups.map((group) => (
          <section className="timeline-block" key={group.key}>
            <div className="timeline-date">
              <InpulseIcon name="gitBranch" size={15} />
              <strong>{group.label}</strong>
              <small>{group.records.length} 条</small>
            </div>
            <div className="record-card-list">
              {group.records.map((item) => (
                <PublishedRecordCard
                  key={item.record.id}
                  item={item}
                  client={client}
                  writable={canWrite(item.record.projectId)}
                  open={publishedId === item.record.id}
                  onToggle={(open) => toggleRecord(item.record.id, open)}
                  onListChanged={() => void list.refetch()}
                />
              ))}
            </div>
          </section>
        ))
      )}
      {standaloneDetail && (
        <section className="record-standalone-detail">
          <PublishedRecordDetail
            projectId={projectId}
            recordId={publishedId}
            client={client}
            writable={canWrite(projectId)}
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
