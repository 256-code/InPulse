import { ExternalLinksPanel } from "@features/external-links/ExternalLinksPanel";
import { useAuth } from "@features/auth/auth-context";
import { RecordLifecycleButton } from "./RecordLifecycleButton";
import { ConvertLeftoverTask } from "./ConvertLeftoverTask";
import { EditPublishedRecord } from "./EditPublishedRecord";
import { taskDetailPath } from "@features/tasks/task-links";
import React, { useMemo, useState } from "react";
import { Alert, Button, Spin } from "antd";
import { useQuery } from "@tanstack/react-query";
import {
  createApiClient,
  type InpulseApiClient,
  type ChangeRecordVersion,
  ApiError,
} from "@generated/api";
import { RecordMarkdown } from "@features/common/components/RecordMarkdown";
import { InpulseIcon } from "@features/common/components/InpulseIcon";
import { CalmBadge } from "@features/common/components/Calm";

/** 正式记录正文的四段字段与中文标签：详情卡展开区与版本差异共用。 */
export const recordContentFields = [
  ["title", "迭代标题"],
  ["contextProblem", "改动原因"],
  ["changeSolution", "具体改动"],
  ["resultVerification", "改动效果"],
  ["remainingIssues", "遗留问题"],
] as const;

/** 逐字段对比两个不可变版本，供「版本差异」区渲染。 */
export function compareRecordVersions(
  before: ChangeRecordVersion,
  after: ChangeRecordVersion,
) {
  return recordContentFields.map(([field, label]) => ({
    field,
    label,
    before: before[field],
    after: after[field],
    changed: before[field] !== after[field],
  }));
}

export function publishedRecordErrorMessage(error: unknown) {
  return error instanceof ApiError && error.status === 401
    ? "登录已失效，请重新登录。"
    : error instanceof ApiError && error.status === 404
      ? "记录不存在或当前无法访问。"
      : "暂时无法加载记录，请重试。";
}

/** 遗留项状态中文标签：逐行列表行尾标记是否闭环。 */
export function leftoverStatusText(
  status: "ACTIVE" | "CONVERTED" | "RESOLVED",
) {
  return status === "ACTIVE"
    ? "未闭环"
    : status === "CONVERTED"
      ? "已转为任务"
      : "已完成";
}

/** 遗留项状态徽章色调：与任务记录列表的状态徽章同一套 CalmBadge。 */
const leftoverTone = {
  ACTIVE: "red",
  CONVERTED: "blue",
  RESOLVED: "green",
} as const;

/**
 * B-3a：正式记录卡片的展开区（设计师稿 record-card 的 record-expanded）。
 * 详情、不可变版本、GitHub 关联、生命周期与遗留项操作按记录 id 独立加载；
 * 折叠时组件卸载，不保留已加载的正文。
 */
export function PublishedRecordDetail({
  projectId,
  recordId,
  client,
  writable,
  onListChanged,
  standalone,
  labels,
}: {
  readonly projectId: number;
  readonly recordId: number;
  readonly client?: InpulseApiClient | undefined;
  readonly writable: boolean;
  readonly onListChanged?: (() => void) | undefined;
  /**
   * 无卡片摘要的独立展开（/records 深链到列表之外的记录）时补身份行：
   * 列表内展开的卡片由 summary 常驻展示编号、版本与状态，不重复渲染。
   */
  readonly standalone?: boolean | undefined;
  /** 列表条目已回填的名称：有值时用名称替代裸 ID（设计师稿 record-facts）。 */
  readonly labels?:
    | {
        readonly project: string;
        readonly module: string;
        readonly feature: string | null;
        readonly author: string;
        readonly impactFeatures: readonly string[];
      }
    | undefined;
}) {
  const { user } = useAuth();
  const api = useMemo(() => client ?? createApiClient(), [client]);
  const [oldVersion, setOldVersion] = useState(0),
    [newVersion, setNewVersion] = useState(0),
    [githubOpen, setGithubOpen] = useState(false);
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
  if (detail.isPending)
    return (
      <section className="record-expanded" aria-label="正式记录详情">
        <Spin />
      </section>
    );
  if (detail.isError)
    return (
      <section className="record-expanded" aria-label="正式记录详情">
        <Alert
          type="error"
          title={publishedRecordErrorMessage(detail.error)}
          action={
            <Button onClick={() => void detail.refetch()}>重试记录</Button>
          }
        />
      </section>
    );
  if (!detail.data)
    return <section className="record-expanded" aria-label="正式记录详情" />;
  const record = detail.data;
  const impactNames =
    labels?.impactFeatures ??
    record.impactFeatureIds.map((id) => `功能 #${id}`);
  return (
    <section className="record-expanded" aria-label="正式记录详情">
      {standalone ? (
        <div className="record-expanded-head">
          <span className="detail-label">
            {record.code} · v{record.currentVersion} ·{" "}
            {record.status === "VOID" ? "已作废" : "已发布"}
          </span>
          <h3>{record.title}</h3>
        </div>
      ) : null}
      {recordContentFields
        .filter(([field]) => field !== "title")
        .map(([field, label]) =>
          field === "remainingIssues" ? (
            <section key={field} aria-label="遗留问题列表">
              <h4>{label}</h4>
              {record.leftovers.length === 0 ? (
                <RecordMarkdown content="暂无已知遗留问题" />
              ) : (
                <ul className="leftover-list">
                  {record.leftovers.map((leftover) => (
                    <li key={leftover.id}>
                      <div className="leftover-content">
                        <RecordMarkdown content={leftover.content} />
                      </div>
                      <CalmBadge tone={leftoverTone[leftover.status]}>
                        {leftoverStatusText(leftover.status)}
                      </CalmBadge>
                      {record.leftoverItem !== null &&
                        leftover.id === record.leftoverItem.id &&
                        record.leftoverItem.status === "CONVERTED" &&
                        record.leftoverItem.linkedTaskId !== null && (
                          <a
                            className="leftover-followup"
                            href={taskDetailPath({
                              projectId: record.projectId,
                              moduleId: record.moduleId,
                              featureId: record.featureId,
                              taskId: record.leftoverItem.linkedTaskId,
                            })}
                          >
                            查看跟进任务
                          </a>
                        )}
                      {record.leftoverItem !== null &&
                        leftover.id === record.leftoverItem.id &&
                        record.leftoverItem.status === "ACTIVE" &&
                        record.status === "PUBLISHED" && (
                          <ConvertLeftoverTask
                            key={`convert-${record.id}-${leftover.id}`}
                            item={record}
                            api={api}
                            writable={writable}
                          />
                        )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : (
            <section key={field}>
              <h4>{label}</h4>
              <RecordMarkdown content={record[field] || "暂无已知遗留问题"} />
            </section>
          ),
        )}
      {record.leftoverItem?.status === "CONVERTED" && (
        <p>遗留项已转为跟进任务，修订文字不会创建第二个任务。</p>
      )}
      {record.leftoverItem?.status === "RESOLVED" && (
        <p>遗留问题已标记为解决，历史内容仍可查看。</p>
      )}
      <dl className="record-facts">
        <dt>归属</dt>
        <dd>
          {labels?.project ?? `项目 #${record.projectId}`} /{" "}
          {labels?.module ?? `模块 #${record.moduleId}`}
          {record.featureId === null
            ? ""
            : ` / ${labels?.feature ?? `功能 #${record.featureId}`}`}
        </dd>
        {impactNames.length > 0 && (
          <>
            <dt>影响功能</dt>
            <dd>{impactNames.join("、")}</dd>
          </>
        )}
        <dt>作者与时间</dt>
        <dd>
          {labels?.author ?? `用户 #${record.authorId}`} · 创建{" "}
          {new Date(record.createdAt).toLocaleString("zh-CN")}
          {record.status === "PUBLISHED"
            ? ` · 发布 ${new Date(record.publishedAt).toLocaleString("zh-CN")}`
            : ""}
        </dd>
        {record.status === "VOID" && (
          <>
            <dt>可见范围</dt>
            <dd>已作废，仅管理员可读取</dd>
          </>
        )}
      </dl>
      {record.taskId !== null && (
        <a
          className="secondary-button record-source-link"
          href={`/projects/${projectId}/modules/${record.moduleId}${record.featureId === null ? "/tasks" : `/features/${record.featureId}`}?taskId=${record.taskId}`}
        >
          <InpulseIcon name="cornerDown" size={14} />
          查看来源任务
        </a>
      )}
      {record.status === "VOID" && (
        <Alert
          type="warning"
          title="已作废 · 仅管理员可见"
          description={
            <>
              最近作废：
              {new Date(record.voidedAt).toLocaleString("zh-CN")}
              <p className="draft-content">{record.voidReason}</p>
            </>
          }
        />
      )}
      {history.length > 1 && (
        <section aria-label="历史版本">
          <h4>历史版本与对比</h4>
          {versions.isPending ? (
            <Spin />
          ) : versions.isError ? (
            <Alert
              type="error"
              title={publishedRecordErrorMessage(versions.error)}
              action={
                <Button onClick={() => void versions.refetch()}>
                  重试版本
                </Button>
              }
            />
          ) : (
            <>
              <p>选择两个版本，逐项查看当时保存的完整内容。</p>
              <div className="record-version-pickers">
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
              </div>
              {before && after && (
                <div aria-label="版本差异">
                  {compareRecordVersions(before, after).map((row) => (
                    <section key={row.field}>
                      <h5>
                        {row.label} · {row.changed ? "有修改" : "无变化"}
                      </h5>
                      <div className="record-version-columns">
                        <div>
                          <strong>v{before.versionNo}</strong>
                          <RecordMarkdown content={row.before || "（空）"} />
                        </div>
                        <div>
                          <strong>v{after.versionNo}</strong>
                          <RecordMarkdown content={row.after || "（空）"} />
                        </div>
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      )}
      <div className="record-github">
        {/* 链接列表可能很长，默认折叠，点击标题展开；折叠时不挂载面板、不发列表请求。 */}
        <button
          type="button"
          className="record-github-toggle"
          aria-expanded={githubOpen}
          onClick={() => setGithubOpen((open) => !open)}
        >
          <InpulseIcon
            name="chevron"
            size={14}
            {...(githubOpen ? { className: "expanded" } : {})}
          />
          <span>GitHub 关联</span>
        </button>
        {githubOpen && (
          <ExternalLinksPanel
            key={record.id}
            targetType="CHANGE_RECORD"
            targetId={record.id}
            client={api}
            variant="inline"
          />
        )}
      </div>
      {(record.status === "PUBLISHED" || user?.isAdmin) && (
        <div className="record-actions">
          {record.status === "PUBLISHED" && (
            <EditPublishedRecord item={record} api={api} writable={writable} />
          )}
          {user?.isAdmin && (
            <RecordLifecycleButton
              item={record}
              api={api}
              onChanged={() => {
                void detail.refetch();
                onListChanged?.();
              }}
            />
          )}
        </div>
      )}
    </section>
  );
}
