import React, { useCallback, useMemo, useState } from "react";
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
import { useChangeRecordsQuery } from "@features/published-records/published-records-query";
import {
  PublishedRecordDetail,
  publishedRecordErrorMessage,
} from "@features/published-records/PublishedRecordDetail";
import { PublishedRecordCard } from "./PublishedRecordCard";
import {
  filterRecords,
  groupRecordsByDate,
  RECORD_SEARCH_PLACEHOLDER,
  RECORD_SOURCE_FILTERS,
  type RecordSourceFilter,
} from "./record-timeline";
import "./records-timeline.css";

type RecordStatus = "PUBLISHED" | "VOID";

/**
 * B-3a：`/records` 单页工作区（设计师稿 views/records.tsx 的结构）。
 * 页头 CTA → 我的草稿条带 → 项目草稿与草稿详情 → 四项筛选 toolbar →
 * 按发布日分组的正式记录卡片。项目仍为必选；跨项目清单、名称回填与
 * 服务端全文检索属于 B-3b 的独立契约纵切片，本轮不做。
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
  const status: RecordStatus =
    params.get("status") === "VOID" && user?.isAdmin ? "VOID" : "PUBLISHED";
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<RecordSourceFilter>("ALL");
  const [createToken, setCreateToken] = useState(0);
  const [canCreate, setCanCreate] = useState(false);
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: ({ signal }) => api.listProjects({ signal }),
    retry: false,
  });
  const list = useChangeRecordsQuery({ client, projectId, status });
  const records = list.data?.pages.flatMap((page) => [...page.items]) ?? [];
  const visible = filterRecords(records, { query, source });
  const groups = groupRecordsByDate(visible);
  const project = projects.data?.items.find((item) => item.id === projectId);
  const writable = project?.status === "ACTIVE";
  const reportCanCreate = useCallback((next: boolean) => {
    setCanCreate((prev) => (prev === next ? prev : next));
  }, []);
  const filtered = query.trim().length > 0 || source !== "ALL";
  const standaloneDetail =
    publishedId > 0 &&
    !list.isPending &&
    !records.some((record) => record.id === publishedId);
  const selectProject = (value: string) => {
    const next = new URLSearchParams();
    if (Number(value) > 0) next.set("projectId", value);
    if (status === "VOID") next.set("status", "VOID");
    setParams(next);
    setQuery("");
    setSource("ALL");
  };
  const selectStatus = (next: RecordStatus) => {
    const nextParams = new URLSearchParams(params);
    if (next === "VOID") nextParams.set("status", "VOID");
    else nextParams.delete("status");
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
          <div className="eyebrow">研发记录 / {visible.length} 条</div>
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
            value={projectId || ""}
            onChange={(event) => selectProject(event.target.value)}
          >
            <option value="">请选择项目</option>
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
                ]
              : [{ value: "PUBLISHED", label: "已发布" }]
          }
          onChange={selectStatus}
        />
      </div>
      {filtered && projectId > 0 && (
        <p className="records-filter-note">
          列表筛选只在当前已加载的 {records.length}{" "}
          条内生效；跨项目与全文检索由后续切片提供。
        </p>
      )}
      {projects.isError && (
        <Alert
          type="error"
          title="项目列表加载失败，请重试。"
          action={
            <Button onClick={() => void projects.refetch()}>重试项目</Button>
          }
        />
      )}
      {projectId === 0 ? (
        <CalmEmptyState
          icon="gitBranch"
          title="请先选择项目"
          description="迭代记录按项目组织；选择项目后可查看草稿与正式记录。"
        />
      ) : list.isPending ? (
        <Spin />
      ) : list.isError ? (
        <Alert
          type="error"
          title={publishedRecordErrorMessage(list.error)}
          action={
            <Button onClick={() => void list.refetch()}>重试记录列表</Button>
          }
        />
      ) : !visible.length ? (
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
              {group.records.map((record) => (
                <PublishedRecordCard
                  key={record.id}
                  item={record}
                  projectId={projectId}
                  client={client}
                  writable={!!writable}
                  open={publishedId === record.id}
                  onToggle={(open) => toggleRecord(record.id, open)}
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
            writable={!!writable}
            onListChanged={() => void list.refetch()}
          />
        </section>
      )}
      {projectId > 0 && list.hasNextPage && (
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
