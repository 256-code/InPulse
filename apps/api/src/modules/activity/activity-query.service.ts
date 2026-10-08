import {
  ACTIVITY_CATEGORIES,
  ACTIVITY_DAY_TOTALS_MAX,
  ACTIVITY_FEED_PROJECT_IDS_MAX,
} from "@inpulse/api-contract";

import {
  TimeCursorError,
  TimeCursorService,
  type TimeCursorValue,
} from "../../cursors/time-cursor.js";
import type {
  AuthorizedProjectScope,
  ProjectAccessQueryPort,
} from "../projects/project-access.port.js";
import { ACTIVITY_ENTITY_TYPES } from "./activity.write-port.js";
import type {
  ActivityCategoryFilter,
  ActivityDayTotal,
  ActivityProjectionItem,
  ActivityProjectionReader,
} from "./activity-projection.reader.js";

export const ACTIVITY_PAGE_LIMIT_DEFAULT = 20;
export const ACTIVITY_PAGE_LIMIT_MAX = 50;

const ACTIVITY_CATEGORY_SET: ReadonlySet<string> = new Set(ACTIVITY_CATEGORIES);

/** 读取来源，决定可见范围与是否允许 `includeAdminOnly`。 */
type ActivityAccess = "scope" | "deleted-project";

export interface ActivityQueryCommand {
  readonly actorUserId: number;
  readonly projectId: number;
  readonly includeAdminOnly?: boolean;
  readonly category?: ActivityCategoryFilter;
  readonly limit?: number;
  readonly after?: string;
}

/**
 * 聚合动态命令：`projectIds` 缺省表示「全部项目」——实时授权范围加全部已删除
 * 项目（ADR-050 / ADR-052 对全部登录用户可见的公开动态链）；显式给出时只用于
 * 收窄，越权或未知项目静默排除，不返回 403 / 404。
 */
export interface ActivityFeedCommand {
  readonly actorUserId: number;
  readonly projectIds?: readonly number[];
  readonly includeAdminOnly?: boolean;
  readonly category?: ActivityCategoryFilter;
  readonly limit?: number;
  readonly after?: string;
}

export interface ActivityQueryPage {
  readonly items: readonly ActivityProjectionItem[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
  /** 与本次过滤同口径的按日全量总数，按日期倒序，不随分页增长。 */
  readonly dayTotals: readonly ActivityDayTotal[];
  readonly dayTotalsTruncated: boolean;
}

export class ActivityQueryValidationError extends Error {
  readonly status:
    | "invalid-project"
    | "invalid-project-ids"
    | "invalid-category"
    | "invalid-limit"
    | "invalid-cursor";

  constructor(status: ActivityQueryValidationError["status"], message: string) {
    super(message);
    this.name = "ActivityQueryValidationError";
    this.status = status;
  }
}

export class ActivityAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActivityAuthorizationError";
  }
}

function parseLimit(limit: number | undefined): number {
  const value = limit ?? ACTIVITY_PAGE_LIMIT_DEFAULT;
  if (!Number.isInteger(value) || value < 1) {
    throw new ActivityQueryValidationError(
      "invalid-limit",
      "limit must be a positive integer",
    );
  }
  return Math.min(value, ACTIVITY_PAGE_LIMIT_MAX);
}

function parseCategory(
  category: ActivityCategoryFilter | undefined,
): ActivityCategoryFilter {
  const value = category ?? "all";
  if (!ACTIVITY_CATEGORY_SET.has(value)) {
    throw new ActivityQueryValidationError(
      "invalid-category",
      "category must be one of the supported activity categories",
    );
  }
  return value;
}

/** 聚合动态的项目集合：1..100 个不重复正整数，返回升序去重结果。 */
function parseProjectIds(projectIds: readonly number[]): readonly number[] {
  if (
    projectIds.length < 1 ||
    projectIds.length > ACTIVITY_FEED_PROJECT_IDS_MAX
  ) {
    throw new ActivityQueryValidationError(
      "invalid-project-ids",
      `projectIds must contain 1 to ${String(ACTIVITY_FEED_PROJECT_IDS_MAX)} ids`,
    );
  }
  const unique = new Set<number>();
  for (const projectId of projectIds) {
    if (!Number.isSafeInteger(projectId) || projectId <= 0) {
      throw new ActivityQueryValidationError(
        "invalid-project-ids",
        "projectIds must be positive integers",
      );
    }
    unique.add(projectId);
  }
  if (unique.size !== projectIds.length) {
    throw new ActivityQueryValidationError(
      "invalid-project-ids",
      "projectIds must not contain duplicates",
    );
  }
  return [...unique].sort((left, right) => left - right);
}

/**
 * 游标指纹：把会改变结果集的请求语义固定进游标，任一参数变化都要求重新从
 * 第一页开始。`scope` 区分单项目路由与聚合路由，防止两条路由的游标互用；
 * `projectIds` 用请求形式（升序去重列表或 all），不用解析后的项目集合——
 * 后者随成员关系与删除状态变化。
 */
function activityFilterKey(input: {
  readonly scope: string;
  readonly category: ActivityCategoryFilter;
  readonly projectIds: readonly number[] | null;
  readonly includeAdminOnly: boolean;
}): string {
  const projects =
    input.projectIds === null
      ? "all"
      : [...input.projectIds].sort((left, right) => left - right).join(",");
  return `v1|scope=${input.scope}|category=${input.category}|projects=${projects}|admin=${input.includeAdminOnly ? "1" : "0"}`;
}

function trimDayTotals(rows: readonly ActivityDayTotal[]): {
  readonly dayTotals: readonly ActivityDayTotal[];
  readonly dayTotalsTruncated: boolean;
} {
  if (rows.length <= ACTIVITY_DAY_TOTALS_MAX) {
    return { dayTotals: rows, dayTotalsTruncated: false };
  }
  // 行按日期倒序，截断保留最近的 ACTIVITY_DAY_TOTALS_MAX 个自然日。
  return {
    dayTotals: rows.slice(0, ACTIVITY_DAY_TOTALS_MAX),
    dayTotalsTruncated: true,
  };
}

export class ActivityQueryService {
  readonly #projectAccess: ProjectAccessQueryPort;
  readonly #reader: ActivityProjectionReader;
  readonly #cursor: TimeCursorService;

  constructor(
    projectAccess: ProjectAccessQueryPort,
    reader: ActivityProjectionReader,
    cursor: TimeCursorService,
  ) {
    this.#projectAccess = projectAccess;
    this.#reader = reader;
    this.#cursor = cursor;
  }

  async query(command: ActivityQueryCommand): Promise<ActivityQueryPage> {
    if (!Number.isSafeInteger(command.projectId) || command.projectId <= 0) {
      throw new ActivityQueryValidationError(
        "invalid-project",
        "projectId must be a positive integer",
      );
    }
    const scope = await this.#projectAccess.getAuthorizedSearchScope(
      command.actorUserId,
    );
    const access = await this.resolveAccess(
      scope,
      command.actorUserId,
      command.projectId,
    );

    const limit = parseLimit(command.limit);
    const category = parseCategory(command.category);
    const includeAdminOnly =
      access === "scope" &&
      scope.isSystemAdmin &&
      command.includeAdminOnly === true;
    const filterKey = activityFilterKey({
      scope: `project:${String(command.projectId)}`,
      category,
      projectIds: null,
      includeAdminOnly,
    });
    const after = this.decodeCursor(command.after, {
      actorUserId: command.actorUserId,
      filterKey,
    });

    const projectIds = [command.projectId] as const;
    const adminOnlyProjectIds = includeAdminOnly ? [...projectIds] : [];
    const dayTotals = await this.loadDayTotals({
      projectIds,
      adminOnlyProjectIds,
      category,
    });
    const page = await this.#reader.read({
      projectIds,
      adminOnlyProjectIds,
      category,
      limit,
      after,
    });
    return this.buildPage(page, {
      actorUserId: command.actorUserId,
      filterKey,
      dayTotals,
    });
  }

  /**
   * 跨项目聚合动态：单一结果集上按 `(occurred_at, id)` 全局游标分页，因此
   * 「加载更多」只会追加更早的条目；`projectIds` 只收窄范围，越权或未知项目
   * 静默排除（不返回 403 / 404）。
   */
  async listFeed(command: ActivityFeedCommand): Promise<ActivityQueryPage> {
    const limit = parseLimit(command.limit);
    const category = parseCategory(command.category);
    const requested =
      command.projectIds === undefined
        ? null
        : parseProjectIds(command.projectIds);
    const scope = await this.#projectAccess.getAuthorizedSearchScope(
      command.actorUserId,
    );
    if (scope.actorUserId !== command.actorUserId) {
      throw new ActivityAuthorizationError(
        "authorization scope actor does not match the request actor",
      );
    }
    const includeAdminOnly =
      scope.isSystemAdmin && command.includeAdminOnly === true;
    const filterKey = activityFilterKey({
      scope: "feed",
      category,
      projectIds: requested,
      includeAdminOnly,
    });
    const after = this.decodeCursor(command.after, {
      actorUserId: command.actorUserId,
      filterKey,
    });

    const deletedProjectIds = await this.#projectAccess.listDeletedProjectIds();
    const allowed = new Set<number>([
      ...scope.projectIds,
      ...deletedProjectIds,
    ]);
    const projectIds =
      requested === null
        ? [...allowed]
        : requested.filter((projectId) => allowed.has(projectId));
    if (projectIds.length === 0) {
      return emptyPage();
    }

    const adminOnlyProjectIds = includeAdminOnly ? [...scope.projectIds] : [];
    const dayTotals = await this.loadDayTotals({
      projectIds,
      adminOnlyProjectIds,
      category,
    });
    const page = await this.#reader.read({
      projectIds,
      adminOnlyProjectIds,
      category,
      limit,
      after,
    });
    return this.buildPage(page, {
      actorUserId: command.actorUserId,
      filterKey,
      dayTotals,
    });
  }

  private async loadDayTotals(input: {
    readonly projectIds: readonly number[];
    readonly adminOnlyProjectIds: readonly number[];
    readonly category: ActivityCategoryFilter;
  }): Promise<{
    readonly dayTotals: readonly ActivityDayTotal[];
    readonly dayTotalsTruncated: boolean;
  }> {
    const rows = await this.#reader.readDayTotals({
      ...input,
      // 多取一行用于判断是否超过契约上限。
      limit: ACTIVITY_DAY_TOTALS_MAX + 1,
    });
    return trimDayTotals(rows);
  }

  private buildPage(
    page: {
      readonly items: readonly ActivityProjectionItem[];
      readonly last: TimeCursorValue | null;
    },
    context: {
      readonly actorUserId: number;
      readonly filterKey: string;
      readonly dayTotals: {
        readonly dayTotals: readonly ActivityDayTotal[];
        readonly dayTotalsTruncated: boolean;
      };
    },
  ): ActivityQueryPage {
    return {
      items: page.items.map(toWhitelistItem),
      nextCursor:
        page.last === null
          ? null
          : this.#cursor.encode({
              actorUserId: context.actorUserId,
              namespace: "ACTIVITY",
              projectId: null,
              afterAt: page.last.at,
              afterId: page.last.id,
              filterKey: context.filterKey,
            }),
      hasMore: page.last !== null,
      dayTotals: context.dayTotals.dayTotals,
      dayTotalsTruncated: context.dayTotals.dayTotalsTruncated,
    };
  }

  private decodeCursor(
    cursor: string | undefined,
    context: { readonly actorUserId: number; readonly filterKey: string },
  ): TimeCursorValue | null {
    try {
      return this.#cursor.decode(cursor, {
        actorUserId: context.actorUserId,
        namespace: "ACTIVITY",
        projectId: null,
        filterKey: context.filterKey,
      });
    } catch (error) {
      if (error instanceof TimeCursorError) {
        throw new ActivityQueryValidationError(
          "invalid-cursor",
          "cursor is invalid, expired, or bound to another query",
        );
      }
      throw error;
    }
  }

  /**
   * 项目在授权范围内时返回 `scope`（按普通项目读）；不在范围内但已被删除时
   * 返回 `deleted-project`（ADR-050 的公开删除记录例外，2026-09-28 扩展为
   * 整个项目链的 MEMBER 可见动态，见 ADR-050 修订；ADMIN_ONLY 仍不回放）；
   * 其余（不存在、无权访问、已移除成员）一律抛出，避免泄露资源存在性。
   */
  private async resolveAccess(
    scope: AuthorizedProjectScope,
    actorUserId: number,
    projectId: number,
  ): Promise<ActivityAccess> {
    if (scope.actorUserId !== actorUserId) {
      throw new ActivityAuthorizationError(
        "authorization scope actor does not match the request actor",
      );
    }
    if (scope.projectIds.includes(projectId)) {
      return "scope";
    }
    if (await this.#projectAccess.isDeletedProject(projectId)) {
      return "deleted-project";
    }
    throw new ActivityAuthorizationError(
      "project is not available to the current actor",
    );
  }
}

function emptyPage(): ActivityQueryPage {
  return {
    items: [],
    nextCursor: null,
    hasMore: false,
    dayTotals: [],
    dayTotalsTruncated: false,
  };
}

function toWhitelistItem(item: ActivityProjectionItem): ActivityProjectionItem {
  if (!ACTIVITY_ENTITY_TYPES.includes(item.sourceEntityType)) {
    throw new Error(
      `activity projection contains unsupported entity type ${item.sourceEntityType}`,
    );
  }
  return item;
}
