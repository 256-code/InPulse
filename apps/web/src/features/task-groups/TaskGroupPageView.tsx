import React, { useState } from "react";
import { Alert, Spin } from "antd";
import type { InpulseApiClient, TaskGroupRecordLink } from "@generated/api";
import { InpulseIcon } from "@features/common/components/InpulseIcon";
import {
  CalmBadge,
  CalmEmptyState,
  CalmSegmented,
} from "@features/common/components/Calm";
import { UnmergeTaskGroupButton } from "./UnmergeTaskGroupButton";
import {
  describeTaskGroupError,
  useTaskGroupQuery,
  useTaskGroupRecordsQuery,
} from "./task-groups-query";
import {
  memberRoleLabel,
  type TaskGroupAdapter,
  type TaskGroupMember,
} from "./task-groups-types";

/**
 * F-25 任务聚合组视图：主任务与来源分支的统一展示（R-1），组内记录按分支
 * 筛选、服务端过滤并以签名游标分页（R-4）。视图只消费服务端字段：不复制
 * 任务或记录实体，也不展示原始审计内容；GitHub 链接按关联时刻快照标注
 * （A 裁决 Q-13 / Q-14）。解除合并入口只对活跃 SOURCE 成员开放
 * （功能设计 18.14，F-24）。
 */

const ALL_RECORDS_VALUE = "all";

const workStatusLabels = {
  TODO: "未完成",
  DONE: "已完成",
  CANCELED: "已取消",
} as const;

const workStatusTone = {
  TODO: "blue",
  DONE: "green",
  CANCELED: "gray",
} as const;

function formatDay(iso: string): string {
  const date = new Date(iso);
  return date.getMonth() + 1 + "月" + date.getDate() + "日";
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", { hour12: false });
}

function linkKindLabel(kind: TaskGroupRecordLink["kind"]): string {
  if (kind === "PULL_REQUEST") return "Pull Request";
  if (kind === "ISSUE") return "Issue";
  if (kind === "COMMIT") return "Commit";
  return "链接";
}

function linkLabel(link: TaskGroupRecordLink): string {
  const repository =
    link.repository === null
      ? ""
      : " · " +
        link.repository +
        (link.externalNumber === null ? "" : " #" + link.externalNumber);
  const sha =
    link.externalSha === null ? "" : " · " + link.externalSha.slice(0, 7);
  return linkKindLabel(link.kind) + repository + sha;
}

export interface TaskGroupPageViewProps {
  readonly groupId: number;
  readonly adapter: TaskGroupAdapter;
  /** 解除合并写路径使用的生成客户端。 */
  readonly api: InpulseApiClient;
  /** URL 承载的记录筛选（F-30）：null 表示全部记录。 */
  readonly memberTaskId: number | null;
  readonly onMemberTaskIdChange: (memberTaskId: number | null) => void;
  readonly onBackToTasks: () => void;
}

export const TaskGroupPageView: React.FC<TaskGroupPageViewProps> = ({
  groupId,
  adapter,
  api,
  memberTaskId,
  onMemberTaskIdChange,
  onBackToTasks,
}) => {
  const groupQuery = useTaskGroupQuery({ groupId, adapter });
  const [unmerged, setUnmerged] = useState(false);

  const group = groupQuery.data?.group ?? null;
  const members = groupQuery.data?.members ?? [];
  const mainMember = members.find((member) => member.role === "MAIN") ?? null;
  const activeSources = members.filter(
    (member) => member.role === "SOURCE" && member.memberStatus === "ACTIVE",
  );
  const effectiveMemberTaskId =
    memberTaskId !== null &&
    members.some((member) => member.taskId === memberTaskId)
      ? memberTaskId
      : null;

  const recordsQuery = useTaskGroupRecordsQuery({
    groupId,
    memberTaskId: effectiveMemberTaskId,
    adapter,
  });
  const records = recordsQuery.data?.pages.flatMap((page) => page.items) ?? [];

  const filterOptions = [
    { value: ALL_RECORDS_VALUE, label: "全部记录" },
    ...members.map((member) => ({
      value: String(member.taskId),
      label: member.role === "MAIN" ? "主任务" : "来源任务 " + member.taskCode,
    })),
  ];

  const renderMember = (member: TaskGroupMember) => (
    <li
      key={member.taskId}
      className={
        member.memberStatus === "DETACHED"
          ? "task-group-member detached"
          : "task-group-member"
      }
      data-testid={"task-group-member-" + member.taskId}
    >
      <div className="task-group-member-head">
        <span className="task-id">{member.taskCode}</span>
        <CalmBadge tone={member.role === "MAIN" ? "violet" : "cyan"}>
          {memberRoleLabel(member)}
        </CalmBadge>
        <CalmBadge tone={workStatusTone[member.workStatus]}>
          {workStatusLabels[member.workStatus]}
        </CalmBadge>
        {member.lifecycleStatus === "ARCHIVED" ? (
          <CalmBadge tone="gray">已归档</CalmBadge>
        ) : null}
      </div>
      <strong>{member.title}</strong>
      <p className="task-group-member-meta">
        {"负责人 " +
          member.assignee.name +
          " · 已发布记录 " +
          member.publishedRecordCount +
          " 条 · 合并于 " +
          formatDay(member.joinedAt)}
        {member.featureId === null ? "" : " · 功能 #" + member.featureId}
      </p>
      {member.memberStatus === "DETACHED" ? (
        <p
          className="permission-hint"
          data-testid={"task-group-detached-" + member.taskId}
        >
          <InpulseIcon name="alert" size={14} />
          {member.detachedAt === null
            ? "已解除合并"
            : "已于 " + formatDateTime(member.detachedAt) + " 解除合并"}
          {member.detachReason === null ? "" : "：" + member.detachReason}
        </p>
      ) : null}
      {member.role === "SOURCE" &&
      member.memberStatus === "ACTIVE" &&
      member.sourceKind === "HISTORICAL" ? (
        <p
          className="permission-hint"
          data-testid={"task-group-historical-" + member.taskId}
        >
          <InpulseIcon name="alert" size={14} />
          {"历史来源分支：后续工作建议归入主任务" +
            (mainMember === null ? "" : " " + mainMember.taskCode) +
            "。"}
        </p>
      ) : null}
      {member.role === "SOURCE" && member.memberStatus === "ACTIVE" ? (
        <div className="task-group-member-actions">
          <UnmergeTaskGroupButton
            groupId={groupId}
            member={{
              taskId: member.taskId,
              taskCode: member.taskCode,
              title: member.title,
            }}
            closesGroup={activeSources.length === 1}
            api={api}
            onReload={async () => {
              await groupQuery.refetch();
            }}
            onChanged={() => setUnmerged(true)}
          />
        </div>
      ) : null}
    </li>
  );

  return (
    <section
      className="task-group"
      aria-label="任务聚合组"
      data-testid="task-group"
    >
      <div className="page-header">
        <div>
          <button type="button" className="back-button" onClick={onBackToTasks}>
            <InpulseIcon name="arrowLeft" size={16} />
            任务中心
          </button>
          <div className="eyebrow">
            {group === null
              ? "聚合组 / TASK GROUP"
              : group.code + " / TASK GROUP"}
          </div>
          <h1>
            {group === null
              ? groupQuery.isPending
                ? "正在加载聚合组…"
                : "任务聚合组"
              : group.name}
          </h1>
          <p>
            {group === null
              ? "聚合组统一展示主任务与来源分支的合并关系、各自迭代记录与 GitHub 链接。"
              : "主任务是统一入口；来源分支保留原任务编号、负责人与全部迭代记录，合并关系不删除历史。"}
          </p>
        </div>
        <div className="catalog-actions">
          {group === null ? null : (
            <CalmBadge tone={group.status === "ACTIVE" ? "violet" : "gray"}>
              {group.status === "ACTIVE" ? "进行中" : "已关闭"}
            </CalmBadge>
          )}
          {group === null ? null : (
            <span className="task-group-created">
              {"创建于 " +
                formatDay(group.createdAt) +
                " · 项目 #" +
                group.projectId}
            </span>
          )}
        </div>
      </div>

      {unmerged ? (
        <div data-testid="task-group-unmerged-notice">
          <Alert type="success" title="已解除合并，聚合组状态与记录已刷新。" />
        </div>
      ) : null}

      <div className="skeleton-note" data-testid="task-group-notice">
        <InpulseIcon name="alert" size={16} />
        <span>
          <strong>接口说明：</strong>
          {adapter.notice}
        </span>
      </div>

      {groupQuery.isPending ? (
        <div className="calm-state">
          <Spin size="large" />
          <p>正在加载聚合组…</p>
        </div>
      ) : groupQuery.isError ? (
        <Alert type="error" title={describeTaskGroupError(groupQuery.error)} />
      ) : (
        <>
          {group !== null && group.status === "CLOSED" ? (
            <Alert
              type="warning"
              title="聚合组已关闭：组内来源分支已全部解除，历史关系与记录仍可查看。"
            />
          ) : null}
          <div className="task-group-panels">
            <section
              className="overview-panel"
              aria-labelledby="task-group-members-title"
            >
              <div className="panel-head">
                <div>
                  <h2 id="task-group-members-title">成员与分支</h2>
                  <p>
                    {activeSources.length > 0
                      ? "活跃来源分支 " +
                        activeSources.length +
                        " 个 · 可逐个解除合并"
                      : "没有活跃来源分支"}
                  </p>
                </div>
              </div>
              {members.length > 0 ? (
                <ul className="task-group-member-list">
                  {members.map(renderMember)}
                </ul>
              ) : (
                <CalmEmptyState
                  icon="gitMerge"
                  title="暂无组成员"
                  description="聚合组创建后，主任务与来源分支会显示在这里。"
                />
              )}
            </section>
            <section
              className="overview-panel"
              aria-labelledby="task-group-records-title"
            >
              <div className="panel-head">
                <div>
                  <h2 id="task-group-records-title">迭代记录</h2>
                  <p>组内已发布与已作废记录；来源按记录归属任务标注</p>
                </div>
              </div>
              <div className="task-group-record-filter">
                <CalmSegmented
                  label="记录筛选"
                  value={
                    effectiveMemberTaskId === null
                      ? ALL_RECORDS_VALUE
                      : String(effectiveMemberTaskId)
                  }
                  options={filterOptions}
                  onChange={(value) =>
                    onMemberTaskIdChange(
                      value === ALL_RECORDS_VALUE ? null : Number(value),
                    )
                  }
                />
              </div>
              {recordsQuery.isPending ? (
                <div className="calm-state">
                  <Spin />
                  <span>正在加载记录</span>
                </div>
              ) : recordsQuery.isError ? (
                <Alert
                  type="error"
                  title={describeTaskGroupError(recordsQuery.error)}
                />
              ) : records.length === 0 ? (
                <CalmEmptyState
                  icon="calendar"
                  title="暂无迭代记录"
                  description={
                    effectiveMemberTaskId === null
                      ? "组内任务发布迭代记录后会按来源汇聚在这里。"
                      : "该分支还没有已发布或已作废的迭代记录。"
                  }
                />
              ) : (
                <>
                  <ul className="task-group-record-list">
                    {records.map((record) => (
                      <li
                        key={record.recordId}
                        data-testid={"task-group-record-" + record.recordId}
                      >
                        <div className="task-group-record-head">
                          <span className="task-id">{record.code}</span>
                          <CalmBadge
                            tone={
                              record.sourceLabel === "主任务"
                                ? "violet"
                                : "cyan"
                            }
                          >
                            {record.sourceLabel === "主任务"
                              ? "主任务"
                              : "来源 " + record.sourceLabel}
                          </CalmBadge>
                          {record.recordStatus === "VOID" ? (
                            <CalmBadge tone="gray">已作废</CalmBadge>
                          ) : null}
                        </div>
                        <strong>{record.title}</strong>
                        <small className="task-group-record-meta">
                          {formatDay(record.publishedAt) + " 发布"}
                          {record.featureId === null
                            ? ""
                            : " · 功能 #" + record.featureId}
                        </small>
                        {record.externalLinks.length > 0 ? (
                          <ul className="task-group-record-links">
                            {record.externalLinks.map((link) => (
                              <li key={link.linkId}>
                                <a
                                  href={link.displayUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  <InpulseIcon name="externalLink" size={13} />
                                  {linkLabel(link)}
                                </a>
                                <small
                                  data-testid={
                                    "task-group-link-snapshot-" + link.linkId
                                  }
                                >
                                  {"快照：" +
                                    (link.titleSnapshot ?? link.displayUrl) +
                                    (link.stateSnapshot === null
                                      ? ""
                                      : " · " + link.stateSnapshot)}
                                </small>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  {recordsQuery.hasNextPage ? (
                    <div className="task-group-load-more">
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={recordsQuery.isFetchingNextPage}
                        onClick={() => void recordsQuery.fetchNextPage()}
                      >
                        {recordsQuery.isFetchingNextPage
                          ? "正在加载…"
                          : "加载更多"}
                      </button>
                    </div>
                  ) : null}
                </>
              )}
            </section>
          </div>
        </>
      )}
    </section>
  );
};

export default TaskGroupPageView;
