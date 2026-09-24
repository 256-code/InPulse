import React, { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ActivityItem, InpulseApiClient } from "@generated/api";
import { useAuth } from "@features/auth/auth-context";
import {
  CalmBadge,
  CalmEmptyState,
  CalmSectionTitle,
} from "@features/common/components/Calm";
import { CalmSelect } from "@features/common/components/CalmSelect";
import { projectSelectOption } from "@features/common/project-select-option";
import { InpulseIcon } from "@features/common/components/InpulseIcon";
import { useProjects } from "@features/projects/project-query";
import { useUserDirectoryQuery } from "@features/users/user-directory-query";
import { ActivitySnapshotModal } from "./ActivitySnapshotModal";
import {
  ACTIVITY_CHIPS,
  activityActionLabel,
  activityEntityLabel,
  activitySubject,
  activityTargetLabel,
  activityTargetPath,
  matchesActivityChip,
  type ActivityChip,
} from "./activity-labels";
import {
  describeActivityError,
  mergeActivityPages,
  useActivityFeedQuery,
} from "./activity-query";

const ALL_PROJECTS = "all";

/** 设计稿 `activity.tsx` 的「审计规则」列表，BR-012 要求必须留痕的操作。 */
const AUDIT_RULES: readonly string[] = [
  "创建、编辑、指派与改派",
  "完成、重新打开、取消与恢复",
  "合并与解除合并",
  "迭代记录发布与版本修改",
  "项目成员变更与组长调整",
  "GitHub 链接添加与删除",
  "管理员作废或恢复历史数据",
];

export interface ActivityWorkspaceProps {
  readonly client?: InpulseApiClient | undefined;
  /** 项目详情页锁定单个项目；不传表示按「全部项目」聚合。 */
  readonly lockedProjectId?: number | undefined;
}

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

export const ActivityWorkspace: React.FC<ActivityWorkspaceProps> = ({
  client,
  lockedProjectId,
}) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = Boolean(user?.isAdmin);
  const [query, setQuery] = useState("");
  const [chip, setChip] = useState<ActivityChip>("全部");
  const [projectFilter, setProjectFilter] = useState<string>(
    lockedProjectId === undefined ? ALL_PROJECTS : String(lockedProjectId),
  );
  const [includeAdminOnly, setIncludeAdminOnly] = useState(false);
  const [snapshotItem, setSnapshotItem] = useState<ActivityItem | null>(null);

  const projectsQuery = useProjects(client ? { client } : {});
  const directoryQuery = useUserDirectoryQuery(client ? { client } : {});

  const projects = useMemo(
    () => projectsQuery.data?.items ?? [],
    [projectsQuery.data],
  );
  const projectNames = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );
  const actorNames = useMemo(
    () =>
      new Map(
        (directoryQuery.data ?? []).map((member) => [member.id, member.name]),
      ),
    [directoryQuery.data],
  );

  const scopeProjectIds = useMemo(() => {
    if (lockedProjectId !== undefined) {
      return [lockedProjectId];
    }
    if (projectFilter !== ALL_PROJECTS) {
      const picked = Number(projectFilter);
      return Number.isSafeInteger(picked) && picked > 0 ? [picked] : [];
    }
    return projects.map((project) => project.id);
  }, [lockedProjectId, projectFilter, projects]);

  // 「全部项目」要先知道有哪些项目才能决定取数范围；锁定项目时可直接取数。
  const lockedScope = lockedProjectId !== undefined;
  const activityQuery = useActivityFeedQuery({
    projectIds: scopeProjectIds,
    ...(client ? { client } : {}),
    includeAdminOnly,
    enabled: lockedScope || !projectsQuery.isPending,
  });

  const actorNameOf = useCallback(
    (actorId: number | null): string => {
      if (actorId === null) {
        return "系统";
      }
      return actorNames.get(actorId) ?? `用户 #${actorId}`;
    },
    [actorNames],
  );

  const items = useMemo(
    () =>
      activityQuery.data ? mergeActivityPages(activityQuery.data.pages) : [],
    [activityQuery.data],
  );

  const filteredItems = useMemo(() => {
    const term = query.trim().toLowerCase();
    return items.filter((item) => {
      if (!matchesActivityChip(item, chip)) {
        return false;
      }
      if (term.length === 0) {
        return true;
      }
      return [
        item.summary,
        activityActionLabel(item.activityType),
        activityEntityLabel(item.sourceEntityType),
        actorNameOf(item.actorId),
        activityTargetLabel(item),
      ]
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  }, [items, query, chip, actorNameOf]);

  const snapshotActorName = snapshotItem
    ? actorNameOf(snapshotItem.actorId)
    : "系统";
  const snapshotProjectName =
    snapshotItem === null
      ? ""
      : (projectNames.get(snapshotItem.projectId) ??
        `项目 #${snapshotItem.projectId}`);

  let content: React.ReactNode;
  if (!lockedScope && projectsQuery.isSuccess && projects.length === 0) {
    content = (
      <CalmEmptyState
        icon="boxes"
        title="还没有可访问的项目"
        description="加入项目后，这里会汇总你可见的全部动态。"
      />
    );
  } else if (activityQuery.isPending) {
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
      <CalmEmptyState
        icon="search"
        title="没有匹配的动态"
        description={
          items.length === 0
            ? "当前范围内还没有可展示的活动投影。"
            : "调整筛选条件后重试。"
        }
      />
    );
  } else {
    content = (
      <>
        <div className="audit-list">
          {filteredItems.map((item) => {
            const time = formatActivityTime(item.occurredAt);
            const actorName = actorNameOf(item.actorId);
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
                  <div className="activity-avatar">{actorName.slice(0, 1)}</div>
                  <div>
                    <strong>
                      {actorName}
                      <span>{activityActionLabel(item.activityType)}</span>
                    </strong>
                    <p>{activitySubject(item.summary)}</p>
                    <small>
                      {(projectNames.get(item.projectId) ??
                        `项目 #${item.projectId}`) +
                        " · " +
                        activityTargetLabel(item)}
                    </small>
                  </div>
                </div>
                <div className="audit-actions">
                  {isAdmin ? (
                    <button
                      type="button"
                      className="small-button"
                      aria-label={`原始快照 ${item.id}`}
                      onClick={() => setSnapshotItem(item)}
                    >
                      <InpulseIcon name="shield" size={13} />
                      原始快照
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="查看对象"
                    title={activityTargetLabel(item)}
                    onClick={() =>
                      navigate(activityTargetPath(item, { isAdmin }))
                    }
                  >
                    <InpulseIcon name="chevronRight" size={16} />
                  </button>
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
          <h1>项目动态</h1>
          <p>
            创建、指派、完成、合并、记录发布与版本修改全部留痕；审计日志不允许删除。
          </p>
        </div>
        <div className="catalog-actions activity-header-actions">
          {lockedProjectId !== undefined ? (
            <span className="activity-scope-badge">
              项目 #{lockedProjectId}
            </span>
          ) : null}
          <CalmBadge tone={isAdmin ? "blue" : "gray"}>
            {isAdmin ? "管理员可查看原始快照" : "仅管理员可查看原始快照"}
          </CalmBadge>
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
          {ACTIVITY_CHIPS.map((option) => (
            <button
              type="button"
              key={option}
              className={`chip${chip === option ? " chip-active" : ""}`}
              aria-pressed={chip === option}
              onClick={() => setChip(option)}
            >
              {option}
            </button>
          ))}
        </div>
        {lockedProjectId === undefined ? (
          <CalmSelect
            ariaLabel="项目"
            value={projectFilter}
            appearance="rich"
            onChange={(next) => setProjectFilter(String(next))}
            options={[
              { value: ALL_PROJECTS, label: "全部项目" },
              ...projects.map(projectSelectOption),
            ]}
          />
        ) : null}
        {isAdmin ? (
          <label className="check-line activity-admin-toggle">
            <input
              type="checkbox"
              checked={includeAdminOnly}
              onChange={(event) =>
                setIncludeAdminOnly(event.currentTarget.checked)
              }
            />
            包含管理员操作
          </label>
        ) : null}
      </div>

      {content}

      <section className="activity-rules">
        <CalmSectionTitle title="审计规则" hint="BR-012 · 以下操作必须记录" />
        <ul className="rule-list">
          {AUDIT_RULES.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </section>

      <ActivitySnapshotModal
        item={snapshotItem}
        actorName={snapshotActorName}
        projectName={snapshotProjectName}
        {...(client ? { client } : {})}
        onClose={() => setSnapshotItem(null)}
      />
    </div>
  );
};

export default ActivityWorkspace;
