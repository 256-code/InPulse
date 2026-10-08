import React, { useCallback, useEffect, useMemo, useState } from "react";
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
import { useStickyBandOffset } from "@features/common/use-sticky-band-offset";
import {
  projectDeletionItems,
  useProjectDeletionsQuery,
} from "@features/projects/project-deletion-query";
import { useProjects } from "@features/projects/project-query";
import { useUserDirectoryQuery } from "@features/users/user-directory-query";
import { ActivitySnapshotModal } from "./ActivitySnapshotModal";
import { ProjectDeletionActions } from "./ProjectDeletionActions";
import { activityTimeLabel, groupActivitiesByDay } from "./activity-day-groups";
import {
  ACTIVITY_CHIP_CATEGORY,
  ACTIVITY_CHIPS,
  activityActionLabel,
  activityDescription,
  activityEntityLabel,
  activityTargetLabel,
  activityTargetPath,
  type ActivityChip,
} from "./activity-labels";
import {
  activityDayTotals,
  describeActivityError,
  flattenActivityPages,
  useActivityFeedQuery,
} from "./activity-query";
import { CalmSkeleton } from "@features/common/components/CalmSkeleton";

const ALL_PROJECTS = "all";
/** ADR-050 修订：已删除项目不在项目列表里，用独立选项聚焦它们的动态。 */
const DELETED_PROJECTS = "deleted";

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
  // 2026-09-24：管理员操作默认勾选——取消勾选会重取第一页，默认打开才不会让
  // 用户以为「勾上以后动态变少了」。
  const [includeAdminOnly, setIncludeAdminOnly] = useState(true);
  const [snapshotItem, setSnapshotItem] = useState<ActivityItem | null>(null);
  /** 动态按天折叠：日期键集合，默认全部展开。 */
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

  const pageRef = React.useRef<HTMLDivElement | null>(null);
  const bandRef = React.useRef<HTMLDivElement | null>(null);
  useStickyBandOffset(pageRef, bandRef);

  const projectsQuery = useProjects(client ? { client } : {});
  const directoryQuery = useUserDirectoryQuery(client ? { client } : {});

  const projects = useMemo(
    () => projectsQuery.data?.items ?? [],
    [projectsQuery.data],
  );
  const lockedScope = lockedProjectId !== undefined;

  // ADR-050：已删除项目不在项目列表里，但它的项目动态（含删除前的完整过程）
  // 对全部登录用户可见。读动态前先取一次删除台账，把已删除项目补进取数范围与项目名。
  const showDeletedProjects =
    !lockedScope &&
    (projectFilter === ALL_PROJECTS || projectFilter === DELETED_PROJECTS);
  const deletionsQuery = useProjectDeletionsQuery({
    ...(client ? { client } : {}),
    enabled: showDeletedProjects,
  });
  const deletedProjects = useMemo(
    () => projectDeletionItems(deletionsQuery.data),
    [deletionsQuery.data],
  );

  const projectNames = useMemo(
    () =>
      new Map([
        ...projects.map((project) => [project.id, project.name] as const),
        ...deletedProjects.map(
          (project) => [project.projectId, project.name] as const,
        ),
      ]),
    [projects, deletedProjects],
  );
  // ADR-051：删除行的两个入口要拿台账条目上的 canRestore / canPurge。
  const deletionsById = useMemo(
    () =>
      new Map(deletedProjects.map((item) => [item.projectId, item] as const)),
    [deletedProjects],
  );
  const actorNames = useMemo(
    () =>
      new Map(
        (directoryQuery.data ?? []).map((member) => [member.id, member.name]),
      ),
    [directoryQuery.data],
  );

  /**
   * 取数范围：
   * - 锁定单项目 → 项目级路由（保留 404 语义）；
   * - 「已删除项目」→ 删除台账里的项目 ID；
   * - 选定单项目 → 只传它；
   * - 「全部项目」→ 不传 projectIds，由服务端用「实时授权范围 + 全部已删除
   *   项目」直接取数，界面不需要先知道有哪些项目，也就不必等项目的读请求。
   */
  const feedScope = useMemo((): {
    readonly projectIds?: readonly number[];
    readonly scopeKey: string;
  } => {
    if (lockedProjectId !== undefined) {
      return { scopeKey: `project:${lockedProjectId}` };
    }
    if (projectFilter === DELETED_PROJECTS) {
      return {
        projectIds: deletedProjects.map((project) => project.projectId),
        scopeKey: "deleted",
      };
    }
    if (projectFilter !== ALL_PROJECTS) {
      const picked = Number(projectFilter);
      if (!Number.isSafeInteger(picked) || picked <= 0) {
        return { projectIds: [], scopeKey: "invalid" };
      }
      return { projectIds: [picked], scopeKey: `project:${picked}` };
    }
    return { scopeKey: "all" };
  }, [lockedProjectId, projectFilter, deletedProjects]);

  const activityQuery = useActivityFeedQuery({
    ...(lockedProjectId === undefined ? {} : { lockedProjectId }),
    ...(feedScope.projectIds === undefined
      ? {}
      : { projectIds: feedScope.projectIds }),
    scopeKey: feedScope.scopeKey,
    category: ACTIVITY_CHIP_CATEGORY[chip],
    includeAdminOnly: isAdmin && includeAdminOnly,
    ...(client ? { client } : {}),
    // 「已删除项目」要先知道有哪些已删除项目，台账未落定前不发请求；
    // 台账读取失败按「没有已删除项目」降级，不影响其余动态。
    enabled: !(
      !lockedScope &&
      projectFilter === DELETED_PROJECTS &&
      deletionsQuery.isPending
    ),
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
      activityQuery.data ? flattenActivityPages(activityQuery.data.pages) : [],
    [activityQuery.data],
  );

  // 日期旁的数量取服务端按日总数（当前过滤条件下的全量），不随加载更多增长。
  const { totals: dayTotals, truncated: dayTotalsTruncated } = useMemo(
    () => activityDayTotals(activityQuery.data?.pages ?? []),
    [activityQuery.data],
  );

  const term = query.trim().toLowerCase();
  const filteredItems = useMemo(() => {
    if (term.length === 0) {
      return items;
    }
    // 分类过滤由服务端完成，这里只剩关键词匹配（只作用于已加载的页）。
    return items.filter((item) =>
      [
        activityDescription(item),
        activityActionLabel(item.activityType),
        activityEntityLabel(item.sourceEntityType),
        actorNameOf(item.actorId),
        activityTargetLabel(item),
      ]
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [items, term, actorNameOf]);

  const dayGroups = useMemo(
    () => groupActivitiesByDay(filteredItems),
    [filteredItems],
  );

  /**
   * 分类已交给服务端；关键词仍在前端匹配已加载的页，命中不到时继续翻页，
   * 直到找到匹配或数据穷尽，期间不给误导性的空态。
   */
  const isSearching = term.length > 0;
  const awaitingFilteredMatch = isSearching && filteredItems.length === 0;
  useEffect(() => {
    if (
      !awaitingFilteredMatch ||
      !activityQuery.hasNextPage ||
      activityQuery.isFetchingNextPage ||
      activityQuery.isError
    ) {
      return;
    }
    void activityQuery.fetchNextPage();
  }, [
    awaitingFilteredMatch,
    activityQuery.hasNextPage,
    activityQuery.isFetchingNextPage,
    activityQuery.isError,
    activityQuery.fetchNextPage,
  ]);

  /**
   * 同一项目可以被删除多次（删除 → 还原 → 再删除）。删除记录是历史过程，
   * 全部保留；但「还原项目」「彻底删除」只反映项目当前状态，因此只对每个
   * 项目最新的一条删除动态开放，其余删除行只展示记录本身。
   */
  const latestDeletionIdByProject = useMemo(() => {
    const latest = new Map<number, string>();
    for (const item of items) {
      if (item.activityType !== "PROJECT_DELETED") continue;
      if (!latest.has(item.projectId)) latest.set(item.projectId, item.id);
    }
    return latest;
  }, [items]);

  const snapshotProjectName =
    snapshotItem === null
      ? ""
      : (projectNames.get(snapshotItem.projectId) ??
        `项目 #${snapshotItem.projectId}`);

  let content: React.ReactNode;
  if (showDeletedProjects && deletionsQuery.isPending) {
    content = (
      <CalmSkeleton variant="timeline" rows={4} label="正在加载项目动态..." />
    );
  } else if (
    !lockedScope &&
    projectFilter === DELETED_PROJECTS &&
    deletedProjects.length === 0
  ) {
    content = (
      <CalmEmptyState
        icon="boxes"
        title="暂无已删除项目"
        description="项目被删除后，删除前的完整动态会保留在这里。"
      />
    );
  } else if (
    !lockedScope &&
    projectsQuery.isSuccess &&
    projects.length === 0 &&
    deletedProjects.length === 0
  ) {
    content = (
      <CalmEmptyState
        icon="boxes"
        title="还没有可访问的项目"
        description="加入项目后，这里会汇总你可见的全部动态。"
      />
    );
  } else if (activityQuery.isPending) {
    content = (
      <CalmSkeleton variant="timeline" rows={4} label="正在加载项目动态..." />
    );
  } else if (activityQuery.isError) {
    content = (
      <div className="activity-state activity-state-error">
        {describeActivityError(activityQuery.error)}
      </div>
    );
  } else if (awaitingFilteredMatch && activityQuery.hasNextPage) {
    content = (
      <div className="activity-state">
        <span className="activity-spinner" />
        正在查找匹配的动态...
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
            : "已加载该范围内的全部动态，没有符合条件的记录。"
        }
      />
    );
  } else {
    content = (
      <>
        {dayTotalsTruncated ? (
          <p className="activity-totals-hint">
            按日数量只统计最近 400 个自然日内的动态。
          </p>
        ) : null}
        <div className="audit-list">
          {dayGroups.map((group) => {
            const collapsed = collapsedDays.has(group.key);
            // 服务端按日总数；超出统计窗口的旧日期退回已加载条数。
            const dayTotal = dayTotals.get(group.key) ?? group.items.length;
            return (
              <section className="activity-day" key={group.key}>
                <div className="activity-day-head">
                  <span aria-hidden="true" className="activity-day-date">
                    {group.shortLabel}
                  </span>
                  <div className="audit-line">
                    <span />
                  </div>
                  <button
                    type="button"
                    className="activity-day-toggle"
                    aria-expanded={!collapsed}
                    title={collapsed ? "展开当天动态" : "收起当天动态"}
                    onClick={() => toggleDay(group.key)}
                  >
                    <InpulseIcon
                      name="chevron"
                      size={14}
                      {...(collapsed ? {} : { className: "expanded" })}
                    />
                    <strong>{group.label}</strong>
                    <small>{dayTotal} 条动态</small>
                  </button>
                </div>
                {collapsed
                  ? null
                  : group.items.map((item) => {
                      const actorName = actorNameOf(item.actorId);
                      const deletion =
                        deletionsById.get(item.projectId) ?? null;
                      const projectDeleted = deletion !== null;
                      // 同项目有多条删除记录时只有最新一条能操作（见 latestDeletionIdByProject）。
                      const deletionActions =
                        item.activityType === "PROJECT_DELETED" &&
                        projectDeleted &&
                        latestDeletionIdByProject.get(item.projectId) ===
                          item.id
                          ? deletion
                          : null;
                      return (
                        <div
                          className="audit-row"
                          key={item.id}
                          data-testid={`activity-item-${item.id}`}
                        >
                          <div className="audit-time">
                            {activityTimeLabel(item.occurredAt)}
                          </div>
                          <div className="audit-line">
                            <span />
                          </div>
                          <div className="audit-content">
                            <div className="activity-avatar">
                              {actorName.slice(0, 1)}
                            </div>
                            <div>
                              <strong>
                                {actorName}
                                <span>
                                  {activityActionLabel(item.activityType)}
                                </span>
                              </strong>
                              <p>{activityDescription(item)}</p>
                              <small>
                                {(projectNames.get(item.projectId) ??
                                  `项目 #${item.projectId}`) +
                                  " · " +
                                  activityTargetLabel(item)}
                              </small>
                            </div>
                          </div>
                          <div className="audit-actions">
                            {/* ADR-051：删除行的「还原项目」「彻底删除」与「原始快照」
                                并排在同一行（快照列最右，两个动作排在其左侧），只在
                                服务端下发的 canRestore / canPurge 为真时渲染。 */}
                            {deletionActions !== null ? (
                              <ProjectDeletionActions
                                deletion={deletionActions}
                                {...(client ? { client } : {})}
                              />
                            ) : null}
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
                            {/* ADR-050：已删除项目的下级对象已不可访问，项目链
                                的每一行都不提供跳转；有「原始快照」的行用与
                                「查看对象」等宽的占位，保持快照列跨行对齐。 */}
                            {projectDeleted ? (
                              isAdmin ? (
                                <span
                                  className="activity-actions-slot"
                                  aria-hidden="true"
                                />
                              ) : null
                            ) : (
                              <button
                                type="button"
                                className="icon-button"
                                aria-label="查看对象"
                                title={activityTargetLabel(item)}
                                onClick={() =>
                                  navigate(
                                    activityTargetPath(item, { isAdmin }),
                                  )
                                }
                              >
                                <InpulseIcon name="chevronRight" size={16} />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
              </section>
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
    <div className="activity-page" ref={pageRef}>
      {/* 2026-10-08 用户要求：页面滚动只滚动红线以下的区域——标题与筛选条吸顶，
          列表与审计规则在其下方滚动（样式见 inpulse-design.css 的 .sticky-page-band）。 */}
      <div className="sticky-page-band" ref={bandRef}>
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
                { value: DELETED_PROJECTS, label: "已删除项目" },
                ...projects.map(projectSelectOption),
              ]}
              animated
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
        projectName={snapshotProjectName}
        {...(client ? { client } : {})}
        onClose={() => setSnapshotItem(null)}
      />
    </div>
  );
};

export default ActivityWorkspace;
