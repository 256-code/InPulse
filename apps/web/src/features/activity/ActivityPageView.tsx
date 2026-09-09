import React, { useMemo, useState } from "react";
import type { ActivityItem, InpulseApiClient } from "@generated/api";
import { InpulseIcon } from "@features/common/components/InpulseIcon";
import {
  describeActivityError,
  useActivityInfiniteQuery,
} from "./activity-query";

type ActivityFilter = "全部" | ActivityItem["sourceEntityType"];

const entityTypeLabels: Readonly<Record<string, string>> = {
  PROJECT: "项目",
  MODULE: "模块",
  FEATURE: "功能",
  TASK: "任务",
  CHANGE_RECORD: "迭代记录",
  EXTERNAL_LINK: "外部链接",
  TASK_GROUP: "任务组",
  LEFTOVER_ITEM: "遗留问题",
};

const activityTypeLabels: Readonly<Record<string, string>> = {
  PROJECT_CREATED: "创建项目",
  PROJECT_JOINED: "加入项目",
  TASK_COMPLETED: "完成任务",
  TASK_ASSIGNED: "指派任务",
  CHANGE_RECORD_VOIDED: "作废记录",
  CHANGE_RECORD_RESTORED: "恢复记录",
};

const filterOptions: readonly { label: string; value: ActivityFilter }[] = [
  { label: "全部", value: "全部" },
  { label: "任务", value: "TASK" },
  { label: "迭代记录", value: "CHANGE_RECORD" },
  { label: "功能", value: "FEATURE" },
  { label: "模块", value: "MODULE" },
  { label: "项目", value: "PROJECT" },
  { label: "任务组", value: "TASK_GROUP" },
  { label: "外部链接", value: "EXTERNAL_LINK" },
  { label: "遗留问题", value: "LEFTOVER_ITEM" },
];

function formatActivityTime(value: string): { date: string; time: string } {
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
  ].join(":");
  return { date, time };
}

function entityTypeLabel(type: string): string {
  return entityTypeLabels[type] ?? type;
}

function activityTypeLabel(type: string): string {
  return activityTypeLabels[type] ?? type;
}

function actorLabel(actorId: number | null): string {
  return actorId === null ? "系统" : `用户 ${actorId}`;
}

export interface ActivityPageViewProps {
  readonly projectId: number;
  readonly client?: InpulseApiClient;
  readonly includeAdminOnly?: boolean;
  readonly onIncludeAdminOnlyChange?: (includeAdminOnly: boolean) => void;
  readonly showAdminToggle?: boolean;
}

export const ActivityPageView: React.FC<ActivityPageViewProps> = ({
  projectId,
  client,
  includeAdminOnly = false,
  onIncludeAdminOnlyChange,
  showAdminToggle = false,
}) => {
  const [query, setQuery] = useState("");
  const [targetType, setTargetType] = useState<ActivityFilter>("全部");
  const activityQuery = useActivityInfiniteQuery({
    projectId,
    client,
    includeAdminOnly,
  });
  const items = useMemo(
    () => activityQuery.data?.pages.flatMap((page) => [...page.items]) ?? [],
    [activityQuery.data],
  );
  const filteredItems = useMemo(() => {
    const term = query.trim().toLowerCase();
    return items.filter((item) => {
      if (targetType !== "全部" && item.sourceEntityType !== targetType) {
        return false;
      }
      if (!term) {
        return true;
      }
      return [
        item.summary,
        activityTypeLabel(item.activityType),
        entityTypeLabel(item.sourceEntityType),
        String(item.sourceEntityId),
        actorLabel(item.actorId),
      ]
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  }, [items, query, targetType]);

  let content: React.ReactNode;
  if (activityQuery.isPending) {
    content = (
      <div className="activity-state">
        <span className="activity-spinner" />
        正在加载项目动态...
      </div>
    );
  } else if (activityQuery.isError) {
    content = (
      <div className="activity-state activity-state-error">
        {describeActivityError(activityQuery.error)}
      </div>
    );
  } else if (filteredItems.length === 0) {
    content = (
      <div className="calm-empty activity-empty">
        <InpulseIcon name="search" size={24} />
        <strong>
          {items.length === 0 ? "暂无项目动态" : "没有匹配的动态"}
        </strong>
        <p>
          {items.length === 0
            ? "当前项目还没有可展示的活动投影。"
            : "调整搜索或切换类型筛选后重试。"}
        </p>
      </div>
    );
  } else {
    content = (
      <>
        <div className="audit-list">
          {filteredItems.map((item) => {
            const time = formatActivityTime(item.occurredAt);
            return (
              <div
                className="audit-row"
                key={item.id}
                data-testid={`activity-item-${item.id}`}
              >
                <div className="audit-time">
                  {time.date}
                  <small>{time.time}</small>
                </div>
                <div className="audit-line">
                  <span />
                </div>
                <div className="audit-content">
                  <div className="activity-avatar">
                    {item.actorId === null ? "系" : `U${item.actorId % 100}`}
                  </div>
                  <div>
                    <strong>
                      {actorLabel(item.actorId)}
                      <span>{activityTypeLabel(item.activityType)}</span>
                    </strong>
                    <p>{item.summary}</p>
                    <small>
                      {entityTypeLabel(item.sourceEntityType)} #
                      {item.sourceEntityId} · 项目 #{item.projectId}
                    </small>
                  </div>
                </div>
                <div className="audit-actions">
                  <span className="audit-entity-badge">
                    {entityTypeLabel(item.sourceEntityType)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        {activityQuery.hasNextPage ? (
          <button
            type="button"
            className="secondary-button activity-load-more"
            disabled={activityQuery.isFetchingNextPage}
            onClick={() => void activityQuery.fetchNextPage()}
          >
            {activityQuery.isFetchingNextPage ? "正在加载..." : "加载更多"}
          </button>
        ) : null}
      </>
    );
  }

  return (
    <div className="activity-page">
      <div className="page-header activity-page-header">
        <div>
          <span className="eyebrow">动态与审计 · F-27</span>
          <h1>项目动态</h1>
          <p>展示服务端按成员权限过滤后的脱敏活动投影；不包含原始审计快照。</p>
        </div>
        <div className="catalog-actions activity-header-actions">
          <span className="activity-scope-badge">项目 #{projectId}</span>
          {showAdminToggle ? (
            <span className="activity-admin-badge">管理员筛选可用</span>
          ) : null}
        </div>
      </div>

      <div className="toolbar task-toolbar activity-toolbar">
        <div className="task-search">
          <InpulseIcon name="search" size={16} />
          <input
            value={query}
            placeholder="搜索操作、对象或执行人"
            aria-label="搜索动态"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </div>
        <div className="chip-row" role="group" aria-label="动态类型筛选">
          {filterOptions.map((option) => (
            <button
              type="button"
              key={option.value}
              className={`chip${targetType === option.value ? " chip-active" : ""}`}
              aria-pressed={targetType === option.value}
              onClick={() => setTargetType(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        {showAdminToggle ? (
          <label className="check-line activity-admin-toggle">
            <input
              type="checkbox"
              checked={includeAdminOnly}
              aria-label="包含管理员操作"
              onChange={(event) =>
                onIncludeAdminOnlyChange?.(event.currentTarget.checked)
              }
            />
            包含管理员操作
          </label>
        ) : null}
      </div>

      {content}

      <section className="activity-rules">
        <div className="calm-section-title">
          <div>
            <h3>展示边界</h3>
            <small>F-27 · 不读取原始审计</small>
          </div>
        </div>
        <ul className="rule-list">
          <li>
            <strong>权限</strong>
            服务端只会返回当前用户可作为成员访问的项目动态。
          </li>
          <li>
            <strong>字段</strong>
            页面只展示白名单摘要、事件类型、对象类型、对象 ID、执行人与时间。
          </li>
          <li>
            <strong>管理员</strong>
            只有系统管理员能显式请求管理员操作；普通成员请求不会扩大范围。
          </li>
        </ul>
      </section>
    </div>
  );
};
