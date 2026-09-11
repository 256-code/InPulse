import React, { useMemo, useState } from "react";
import { Alert, Spin } from "antd";
import {
  createApiClient,
  type InpulseApiClient,
  type LeftoverListItem,
} from "@generated/api";
import { InpulseIcon } from "@features/common/components/InpulseIcon";
import {
  CalmBadge,
  CalmEmptyState,
  CalmSectionTitle,
} from "@features/common/components/Calm";
import {
  LeftoverTaskConvertModal,
  type LeftoverConvertTarget,
} from "@features/published-records/ConvertLeftoverTask";
import type { TaskLocation } from "@features/tasks/task-links";
import { issueOriginText, isLeftoverClosed } from "./issues-format";
import { describeIssuesError, useLeftoverItemsQuery } from "./issues-query";

/**
 * F-20 遗留问题页（R-6）：未闭环与已闭环两个分桶各自按服务端签名游标分页，
 * 行内保留来源记录与来源 / 跟进任务引用，未闭环项可直接转为跟进任务（复用
 * 已发布记录页的转换弹窗：CSRF、If-Match 与幂等键语义完全一致）。
 *
 * 与设计稿的显式差异：CLOSED 桶按服务端口径同时包含 CONVERTED 与 RESOLVED，
 * 其中 RESOLVED 没有跟进任务，因此「转为任务」入口只出现在未闭环项；
 * 已闭环且无跟进任务的行不再提供无法完成的入口。
 */

export interface IssuesPageViewProps {
  readonly client?: InpulseApiClient;
  readonly onBackToRecords?: () => void;
  readonly onOpenTask?: (task: TaskLocation) => void;
}

export const IssuesPageView: React.FC<IssuesPageViewProps> = ({
  client,
  onBackToRecords,
  onOpenTask,
}) => {
  const api = useMemo(() => client ?? createApiClient(), [client]);
  const [convertTarget, setConvertTarget] =
    useState<LeftoverConvertTarget | null>(null);
  const openQuery = useLeftoverItemsQuery({ client, bucket: "OPEN" });
  const closedQuery = useLeftoverItemsQuery({ client, bucket: "CLOSED" });
  const openItems =
    openQuery.data?.pages.flatMap((page) => [...page.items]) ?? [];
  const closedItems =
    closedQuery.data?.pages.flatMap((page) => [...page.items]) ?? [];

  const renderRow = (item: LeftoverListItem) => {
    const closed = isLeftoverClosed(item);
    const sourceTask = item.sourceTask;
    const followupTask = item.followupTask;
    return (
      <article
        className="issue-row"
        key={item.leftoverItemId}
        data-testid={"leftover-item-" + item.leftoverItemId}
      >
        <div className="issue-main">
          <div className="issue-head">
            <CalmBadge tone={closed ? "green" : "amber"}>
              {closed ? "已闭环" : "待闭环"}
            </CalmBadge>
            <span className="task-id">{item.recordCode}</span>
            <strong>{item.content}</strong>
          </div>
          <p className="issue-origin">{issueOriginText(item)}</p>
        </div>
        <div className="issue-actions">
          {sourceTask === null ? null : (
            <button
              type="button"
              className="secondary-button"
              onClick={() =>
                onOpenTask?.({
                  projectId: sourceTask.projectId,
                  moduleId: sourceTask.moduleId,
                  featureId: sourceTask.featureId,
                  taskId: sourceTask.taskId,
                })
              }
            >
              <InpulseIcon name="gitBranch" size={14} />
              来源任务 {sourceTask.code}
            </button>
          )}
          {followupTask === null ? (
            closed ? null : (
              <button
                type="button"
                className="primary-button"
                onClick={() =>
                  setConvertTarget({
                    projectId: item.projectId,
                    moduleId: item.moduleId,
                    featureId: item.featureId,
                    recordId: item.recordId,
                    recordTitle: item.recordTitle,
                  })
                }
              >
                <InpulseIcon name="zap" size={14} />
                转为任务
              </button>
            )
          ) : (
            <button
              type="button"
              className="secondary-button"
              onClick={() =>
                onOpenTask?.({
                  projectId: followupTask.projectId,
                  moduleId: followupTask.moduleId,
                  featureId: followupTask.featureId,
                  taskId: followupTask.taskId,
                })
              }
            >
              查看跟进任务 {followupTask.code}
              <InpulseIcon name="chevronRight" size={14} />
            </button>
          )}
        </div>
      </article>
    );
  };

  return (
    <section
      className="issues-page"
      aria-label="遗留问题"
      data-testid="issues-page"
    >
      <div className="page-header">
        <div>
          <div className="eyebrow">
            {"遗留问题 / " + String(openItems.length) + " 条未闭环"}
          </div>
          <h1>遗留问题</h1>
          <p>
            迭代记录中写下的「还有什么问题」会汇总到这里，确认影响范围后转为可执行任务。
          </p>
        </div>
        <div className="catalog-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={onBackToRecords}
          >
            <InpulseIcon name="gitBranch" size={15} />
            回到迭代记录
          </button>
        </div>
      </div>

      <div className="callout">
        <InpulseIcon name="alert" size={18} />
        <div>
          <strong>问题不是任务</strong>
          <p>
            转为任务时系统会自动带入来源项目、模块、功能与遗留问题描述，并把来源记录标记为已闭环；原记录内容不会被修改。
          </p>
        </div>
      </div>

      <CalmSectionTitle
        title="未闭环"
        hint={String(openItems.length) + " 条 · 按发布时间倒序"}
      />
      {openQuery.isPending ? (
        <div className="calm-state">
          <Spin size="large" />
          <p>正在加载遗留问题…</p>
        </div>
      ) : openQuery.isError ? (
        <Alert type="error" title={describeIssuesError(openQuery.error)} />
      ) : openItems.length === 0 ? (
        <CalmEmptyState
          icon="check"
          title="没有待闭环的遗留问题"
          description="所有已发布记录的遗留事项都已经转为跟进任务。"
        />
      ) : (
        <>
          <div className="issue-list">{openItems.map(renderRow)}</div>
          {openQuery.hasNextPage ? (
            <div className="issue-load-more">
              <button
                type="button"
                className="secondary-button"
                disabled={openQuery.isFetchingNextPage}
                onClick={() => void openQuery.fetchNextPage()}
              >
                {openQuery.isFetchingNextPage ? "正在加载…" : "加载更多"}
              </button>
            </div>
          ) : null}
        </>
      )}

      {closedItems.length > 0 || closedQuery.isError ? (
        <details className="calm-disclosure history-block">
          <summary>
            {"已闭环 " + String(closedItems.length) + " 条 · 已生成跟进任务"}
          </summary>
          {closedQuery.isError ? (
            <Alert
              type="error"
              title={describeIssuesError(closedQuery.error)}
            />
          ) : (
            <>
              <div className="issue-list">{closedItems.map(renderRow)}</div>
              {closedQuery.hasNextPage ? (
                <div className="issue-load-more">
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={closedQuery.isFetchingNextPage}
                    onClick={() => void closedQuery.fetchNextPage()}
                  >
                    {closedQuery.isFetchingNextPage ? "正在加载…" : "加载更多"}
                  </button>
                </div>
              ) : null}
            </>
          )}
        </details>
      ) : null}

      {convertTarget === null ? null : (
        <LeftoverTaskConvertModal
          target={convertTarget}
          api={api}
          open={true}
          onClose={() => setConvertTarget(null)}
          onConverted={(created) => {
            setConvertTarget(null);
            onOpenTask?.({
              projectId: created.projectId,
              moduleId: created.moduleId,
              featureId: created.featureId,
              taskId: created.taskId,
            });
          }}
        />
      )}
    </section>
  );
};

export default IssuesPageView;
