import { ExternalLinksPanel } from "@features/external-links/ExternalLinksPanel";
import { useAuth } from "@features/auth/auth-context";
import { RecordLifecycleButton } from "./RecordLifecycleButton";
import { ConvertLeftoverTask } from "./ConvertLeftoverTask";
import React, { useMemo, useState } from "react";
import { EditPublishedRecord } from "./EditPublishedRecord";
import { Alert, Button, Spin } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  createApiClient,
  type InpulseApiClient,
  type ChangeRecordVersion,
  ApiError,
} from "@generated/api";
import {
  CalmBadge,
  CalmEmptyState,
  CalmSectionTitle,
} from "@features/common/components/Calm";
import { RecordMarkdown } from "@features/common/components/RecordMarkdown";
import { useChangeRecordsQuery } from "./published-records-query";
import "@features/record-drafts/record-drafts.css";
const fields = [
  ["title", "迭代标题"],
  ["contextProblem", "为什么改、发现了什么问题"],
  ["changeSolution", "改了什么、怎么改的"],
  ["resultVerification", "改完效果如何、如何验证"],
  ["remainingIssues", "还有什么问题"],
] as const;
export function compareRecordVersions(
  before: ChangeRecordVersion,
  after: ChangeRecordVersion,
) {
  return fields.map(([field, label]) => ({
    field,
    label,
    before: before[field],
    after: after[field],
    changed: before[field] !== after[field],
  }));
}
function message(error: unknown) {
  return error instanceof ApiError && error.status === 401
    ? "登录已失效，请重新登录。"
    : error instanceof ApiError && error.status === 404
      ? "记录不存在或当前无法访问。"
      : "暂时无法加载记录，请重试。";
}
export function PublishedRecordsView({
  client,
}: {
  client?: InpulseApiClient;
}) {
  const { user } = useAuth();
  const api = useMemo(() => client ?? createApiClient(), [client]);
  const [params, setParams] = useSearchParams();
  const projectId = Number(params.get("projectId")) || 0,
    recordId = Number(params.get("publishedId")) || 0;
  const status =
    params.get("status") === "VOID" && user?.isAdmin ? "VOID" : "PUBLISHED";
  const [oldVersion, setOldVersion] = useState(0),
    [newVersion, setNewVersion] = useState(0);
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: ({ signal }) => api.listProjects({ signal }),
    retry: false,
  });
  const list = useChangeRecordsQuery({ client, projectId, status });
  const records = list.data?.pages.flatMap((page) => [...page.items]) ?? [];
  const detail = useQuery({
    queryKey: ["published-record", projectId, recordId],
    queryFn: ({ signal }) =>
      api.getChangeRecord(projectId, recordId, { signal }),
    enabled: projectId > 0 && recordId > 0,
    retry: false,
  });
  const versions = useQuery({
    queryKey: ["record-versions", projectId, recordId],
    queryFn: ({ signal }) =>
      api.listChangeRecordVersions(projectId, recordId, { signal }),
    enabled: projectId > 0 && recordId > 0 && !!detail.data,
    retry: false,
  });
  const history = versions.data?.items ?? [];
  const before =
    history.find((v) => v.versionNo === oldVersion) ??
    history[history.length - 1];
  const after = history.find((v) => v.versionNo === newVersion) ?? history[0];
  return (
    <section className="record-drafts-page" aria-label="正式迭代记录">
      <CalmSectionTitle
        title={status === "VOID" ? "已作废记录" : "已发布记录"}
        hint="查看已发布的变化与每次内容修订，历史版本始终保留。"
      >
        <CalmBadge>正式记录</CalmBadge>
      </CalmSectionTitle>
      {user?.isAdmin && (
        <label>
          记录状态{" "}
          <select
            aria-label="记录状态"
            value={status}
            onChange={(e) =>
              setParams({
                view: "published",
                projectId: String(projectId),
                status: e.target.value,
              })
            }
          >
            <option value="PUBLISHED">已发布</option>
            <option value="VOID">已作废（管理员）</option>
          </select>
        </label>
      )}
      <label className="draft-project-selector">
        所属项目
        <select
          value={projectId}
          onChange={(e) => {
            setParams({ view: "published", projectId: e.target.value, status });
            setOldVersion(0);
            setNewVersion(0);
          }}
        >
          <option value={0}>请选择项目</option>
          {projects.data?.items.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      {projects.isError && (
        <Alert type="error" title={message(projects.error)} />
      )}
      {projectId > 0 &&
        (list.isPending ? (
          <Spin />
        ) : list.isError ? (
          <Alert
            type="error"
            title={message(list.error)}
            action={
              <Button onClick={() => void list.refetch()}>重试记录列表</Button>
            }
          />
        ) : !records.length ? (
          <CalmEmptyState
            icon="gitBranch"
            title={status === "VOID" ? "暂无已作废记录" : "暂无已发布记录"}
            description="草稿发布后会出现在这里。"
          />
        ) : (
          <div className="calm-task-grid">
            {records.map((item) => (
              <article className="calm-task-card" key={item.id}>
                <CalmBadge>
                  {item.code} · v{item.currentVersion}
                </CalmBadge>
                <h3>{item.title}</h3>
                <p>{new Date(item.publishedAt).toLocaleString("zh-CN")}</p>
                <Button
                  onClick={() => {
                    setParams({
                      view: "published",
                      status,
                      projectId: String(projectId),
                      publishedId: String(item.id),
                    });
                    setOldVersion(0);
                    setNewVersion(0);
                  }}
                >
                  查看记录
                </Button>
              </article>
            ))}
          </div>
        ))}
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
      {recordId > 0 &&
        (detail.isPending ? (
          <Spin />
        ) : detail.isError ? (
          <Alert type="error" title={message(detail.error)} />
        ) : (
          detail.data && (
            <section className="draft-detail" aria-label="正式记录详情">
              <h2>{detail.data.title}</h2>
              <ExternalLinksPanel
                key={detail.data.id}
                targetType="CHANGE_RECORD"
                targetId={detail.data.id}
                client={api}
              />
              {user?.isAdmin && (
                <RecordLifecycleButton
                  item={detail.data}
                  api={api}
                  onChanged={() => {
                    void detail.refetch();
                    void list.refetch();
                  }}
                />
              )}
              {detail.data.status === "VOID" && (
                <Alert
                  type="warning"
                  title="已作废 · 仅管理员可见"
                  description={
                    <>
                      最近作废：
                      {new Date(detail.data.voidedAt).toLocaleString("zh-CN")}
                      <p className="draft-content">{detail.data.voidReason}</p>
                    </>
                  }
                />
              )}
              {detail.data.status === "PUBLISHED" && (
                <>
                  <ConvertLeftoverTask
                    key={detail.data.id}
                    item={detail.data}
                    api={api}
                    writable={
                      projects.data?.items.find((p) => p.id === projectId)
                        ?.status === "ACTIVE"
                    }
                  />
                  <EditPublishedRecord
                    item={detail.data}
                    api={api}
                    writable={
                      projects.data?.items.find((p) => p.id === projectId)
                        ?.status === "ACTIVE"
                    }
                  />
                </>
              )}
              {detail.data.leftoverItem?.status === "CONVERTED" && (
                <p>遗留项已转为跟进任务，修订文字不会创建第二个任务。</p>
              )}
              {detail.data.leftoverItem?.status === "RESOLVED" && (
                <p>遗留问题已标记为解决，历史内容仍可查看。</p>
              )}
              <p>
                {detail.data.code} · v{detail.data.currentVersion} ·{" "}
                {detail.data.status === "VOID" ? "已作废" : "已发布"}
              </p>
              <p>
                处理人 #{detail.data.handlerId} · 记录作者 #
                {detail.data.authorId}
              </p>
              {detail.data.taskId !== null && (
                <a
                  href={`/projects/${projectId}/modules/${detail.data.moduleId}${detail.data.featureId === null ? "/tasks" : `/features/${detail.data.featureId}`}?taskId=${detail.data.taskId}`}
                >
                  查看来源任务
                </a>
              )}
              {fields
                .filter(([field]) => field !== "title")
                .map(([field, label]) => (
                  <section key={field}>
                    <h3>{label}</h3>
                    <RecordMarkdown
                      content={detail.data![field] || "暂无已知遗留问题"}
                    />
                  </section>
                ))}
              <section aria-label="历史版本">
                <h3>历史版本与对比</h3>
                {versions.isPending ? (
                  <Spin />
                ) : versions.isError ? (
                  <Alert
                    type="error"
                    title={message(versions.error)}
                    action={
                      <Button onClick={() => void versions.refetch()}>
                        重试版本
                      </Button>
                    }
                  />
                ) : (
                  <>
                    <p>选择两个版本，逐项查看当时保存的完整内容。</p>
                    <label>
                      较早版本
                      <select
                        value={before?.versionNo ?? ""}
                        onChange={(e) => setOldVersion(Number(e.target.value))}
                      >
                        {history.map((v) => (
                          <option key={v.versionNo} value={v.versionNo}>
                            v{v.versionNo} ·{" "}
                            {new Date(v.createdAt).toLocaleString("zh-CN")}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      对照版本
                      <select
                        value={after?.versionNo ?? ""}
                        onChange={(e) => setNewVersion(Number(e.target.value))}
                      >
                        {history.map((v) => (
                          <option key={v.versionNo} value={v.versionNo}>
                            v{v.versionNo} ·{" "}
                            {new Date(v.createdAt).toLocaleString("zh-CN")}
                          </option>
                        ))}
                      </select>
                    </label>
                    {before && after && (
                      <div aria-label="版本差异">
                        {compareRecordVersions(before, after).map((row) => (
                          <section key={row.field}>
                            <h4>
                              {row.label} · {row.changed ? "有修改" : "无变化"}
                            </h4>
                            <div className="record-version-columns">
                              <div>
                                <strong>v{before.versionNo}</strong>
                                <RecordMarkdown
                                  content={row.before || "（空）"}
                                />
                              </div>
                              <div>
                                <strong>v{after.versionNo}</strong>
                                <RecordMarkdown
                                  content={row.after || "（空）"}
                                />
                              </div>
                            </div>
                          </section>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </section>
            </section>
          )
        ))}
    </section>
  );
}
