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
  ACTIVITY_CHIPS,
  activityActionLabel,
  activityDescription,
  activityEntityLabel,
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
  const [includeAdminOnly, setIncludeAdminOnly] = useState(false);
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

  const scopeProjectIds = useMemo(() => {
    if (lockedProjectId !== undefined) {
      return [lockedProjectId];
    }
    if (projectFilter === DELETED_PROJECTS) {
      return deletedProjects.map((project) => project.projectId);
    }
    if (projectFilter !== ALL_PROJECTS) {
      const picked = Number(projectFilter);
      return Number.isSafeInteger(picked) && picked > 0 ? [picked] : [];
    }
    return [
      ...projects.map((project) => project.id),
      ...deletedProjects.map((project) => project.projectId),
    ];
  }, [lockedProjectId, projectFilter, projects, deletedProjects]);

  // 「全部项目」要先知道有哪些项目才能决定取数范围；锁定项目时可直接取数。
  const activityQuery = useActivityFeedQuery({
    projectIds: scopeProjectIds,
    ...(client ? { client } : {}),
    includeAdminOnly,
    // 台账未落定前不发动态请求，避免先少一次再重取；
    // 台账读取失败按「没有已删除项目」降级，不影响其余动态。
    enabled:
      (lockedScope || !projectsQuery.isPending) &&
      (showDeletedProjects ? !deletionsQuery.isPending : true),
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
        activityDescription(item),
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

  const dayGroups = useMemo(
    () => groupActivitiesByDay(filteredItems),
    [filteredItems],
  );

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

  const snapshotActorName = snapshotItem
    ? actorNameOf(snapshotItem.actorId)
    : "系统";
  const snapshotProjectName =
    snapshotItem === null
      ? ""
      : (projectNames.get(snapshotItem.projectId) ??
        `项目 #${snapshotItem.projectId}`);

  let content: React.ReactNode;
  if (showDeletedProjects && deletionsQuery.isPending) {
    content = (
      <div className="activity-state">
        <span className="activity-spinner" />
        正在加载项目动态...
      </div>
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
          {dayGroups.map((group) => {
            const collapsed = collapsedDays.has(group.key);
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
                    <small>{group.items.length} 条动态</small>
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
                          <div className="audit-actions activity-actions">
                            <div className="activity-actions-main">
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
                              {/* ADR-050：已删除项目的下级对象已不可访问，
                                  项目链的每一行都不提供跳转；用与「查看对象」同宽
                                  的占位槽补位，使「原始快照」在所有行落在同一列
                                  （没有「原始快照」时不占位）。 */}
                              {projectDeleted ? (
                                <span
                                  aria-hidden="true"
                                  className="activity-actions-slot"
                                />
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
                            {/* ADR-051：删除行用「还原项目」「彻底删除」代替跳转。
                                两个入口只在服务端下发的 canRestore / canPurge 为真时
                                渲染，并另起一行：并排会撑宽整个动作区，把「原始快照」
                                挤出上面那一列。 */}
                            {deletionActions !== null ? (
                              <ProjectDeletionActions
                                deletion={deletionActions}
                                {...(client ? { client } : {})}
                              />
                            ) : null}
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
              { value: DELETED_PROJECTS, label: "已删除项目" },
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
