import { ExternalLinksPanel } from "@features/external-links/ExternalLinksPanel";
import { useAuth } from "@features/auth/auth-context";
import { RecordLifecycleButton } from "./RecordLifecycleButton";
import { ConvertLeftoverTask } from "./ConvertLeftoverTask";
import { EditPublishedRecord } from "./EditPublishedRecord";
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

/** 正式记录正文的四段字段与中文标签：详情卡展开区与版本差异共用。 */
export const recordContentFields = [
  ["title", "迭代标题"],
  ["contextProblem", "为什么改、发现了什么问题"],
  ["changeSolution", "改了什么、怎么改的"],
  ["resultVerification", "改完效果如何、如何验证"],
  ["remainingIssues", "还有什么问题"],
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
}: {
  readonly projectId: number;
  readonly recordId: number;
  readonly client?: InpulseApiClient | undefined;
  readonly writable: boolean;
  readonly onListChanged?: (() => void) | undefined;
}) {
  const { user } = useAuth();
  const api = useMemo(() => client ?? createApiClient(), [client]);
  const [oldVersion, setOldVersion] = useState(0),
    [newVersion, setNewVersion] = useState(0);
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
  return (
    <section className="record-expanded" aria-label="正式记录详情">
      <div className="record-expanded-head">
        <h3>{record.title}</h3>
        <ExternalLinksPanel
          key={record.id}
          targetType="CHANGE_RECORD"
          targetId={record.id}
          client={api}
        />
      </div>
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
      {record.status === "PUBLISHED" && (
        <>
          <ConvertLeftoverTask
            key={record.id}
            item={record}
            api={api}
            writable={writable}
          />
          <EditPublishedRecord item={record} api={api} writable={writable} />
        </>
      )}
      {record.leftoverItem?.status === "CONVERTED" && (
        <p>遗留项已转为跟进任务，修订文字不会创建第二个任务。</p>
      )}
      {record.leftoverItem?.status === "RESOLVED" && (
        <p>遗留问题已标记为解决，历史内容仍可查看。</p>
      )}
      <dl className="record-facts">
        <dt>记录编号</dt>
        <dd>
          {record.code} · v{record.currentVersion} ·{" "}
          {record.status === "VOID" ? "已作废" : "已发布"}
        </dd>
        <dt>归属</dt>
        <dd>
          项目 #{record.projectId} / 模块 #{record.moduleId}
          {record.featureId === null
            ? ` / 影响功能：${record.impactFeatureIds.join("、") || "未选择"}`
            : ` / 功能 #${record.featureId}`}
        </dd>
        <dt>处理人与作者</dt>
        <dd>
          处理人 #{record.handlerId} · 记录作者 #{record.authorId}
        </dd>
      </dl>
      {record.taskId !== null && (
        <a
          href={`/projects/${projectId}/modules/${record.moduleId}${record.featureId === null ? "/tasks" : `/features/${record.featureId}`}?taskId=${record.taskId}`}
        >
          查看来源任务
        </a>
      )}
      {recordContentFields
        .filter(([field]) => field !== "title")
        .map(([field, label]) => (
          <section key={field}>
            <h4>{label}</h4>
            <RecordMarkdown content={record[field] || "暂无已知遗留问题"} />
          </section>
        ))}
      <section aria-label="历史版本">
        <h4>历史版本与对比</h4>
        {versions.isPending ? (
          <Spin />
        ) : versions.isError ? (
          <Alert
            type="error"
            title={publishedRecordErrorMessage(versions.error)}
            action={
              <Button onClick={() => void versions.refetch()}>重试版本</Button>
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
    </section>
  );
}
