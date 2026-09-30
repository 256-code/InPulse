import type { Sql } from "postgres";

import type {
  ProjectDeletionItem,
  ProjectDeletionPage,
} from "@inpulse/api-contract";
import {
  TimeCursorError,
  TimeCursorService,
  type TimeCursorValue,
} from "../../cursors/time-cursor.js";

export const PROJECT_DELETION_CURSOR_NAMESPACE = "PROJECT_DELETION";
export const PROJECT_DELETION_PAGE_LIMIT_DEFAULT = 20;
export const PROJECT_DELETION_PAGE_LIMIT_MAX = 50;

export interface ProjectDeletionQueryCommand {
  readonly actorUserId: number;
  readonly limit?: number;
  readonly after?: string;
}

interface ProjectDeletionRow {
  readonly project_id: number;
  readonly code: string;
  readonly name: string;
  readonly deleted_at: string;
  readonly deleted_by_id: number;
  readonly deleted_by_name: string;
  readonly actor_is_admin: boolean;
  readonly actor_is_leader: boolean;
}

export class ProjectDeletionQueryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectDeletionQueryValidationError";
  }
}

function parseLimit(limit: number | undefined): number {
  const value = limit ?? PROJECT_DELETION_PAGE_LIMIT_DEFAULT;
  if (!Number.isInteger(value) || value < 1) {
    throw new ProjectDeletionQueryValidationError(
      "limit must be a positive integer",
    );
  }
  return Math.min(value, PROJECT_DELETION_PAGE_LIMIT_MAX);
}

function toItem(row: ProjectDeletionRow): ProjectDeletionItem {
  return {
    projectId: row.project_id,
    code: row.code,
    name: row.name,
    deletedAt: row.deleted_at,
    deletedBy: { id: row.deleted_by_id, name: row.deleted_by_name },
    // ADR-051：还原与删除同一口径（系统管理员或本项目实时 ACTIVE 组长），
    // 彻底删除只有系统管理员；这里只决定前端是否渲染入口，写路径会重新判定。
    canRestore: row.actor_is_admin || row.actor_is_leader,
    canPurge: row.actor_is_admin,
  };
}

/**
 * ADR-050 项目删除记录读取：数据源是 `app.projects` 的软删除标记本身
 * （`deleted_at`/`deleted_by`，见 ADR-049），因此记录不随任何可见性或
 * 投影重建而消失，也不需要新的写路径或迁移。这里只返回删除台账的四个
 * 叶子信息，任何已删除项目的正文都必须继续走各自原有（且已经关闭）的读路径。
 *
 * ADR-051：同一条查询顺带按当前操作者的实时身份（`app.users.is_admin` 与
 * `app.project_members` 的 ACTIVE LEADER）给出 `canRestore` / `canPurge`，
 * 让前端只渲染真正可用的入口；两者都是即时读，不缓存进 Session，
 * 写路径仍会独立重新判定，因此这里的结果只用于展示。
 */
export class ProjectDeletionsQueryService {
  readonly #sql: Sql;
  readonly #cursor: TimeCursorService;

  constructor(sql: Sql, cursor: TimeCursorService) {
    this.#sql = sql;
    this.#cursor = cursor;
  }

  async query(
    command: ProjectDeletionQueryCommand,
  ): Promise<ProjectDeletionPage> {
    const limit = parseLimit(command.limit);
    let after: TimeCursorValue | null;
    try {
      after = this.#cursor.decode(command.after, {
        actorUserId: command.actorUserId,
        namespace: PROJECT_DELETION_CURSOR_NAMESPACE,
        projectId: null,
      });
    } catch (error) {
      if (error instanceof TimeCursorError) {
        throw new ProjectDeletionQueryValidationError(
          "cursor is invalid, expired, or bound to another user",
        );
      }
      throw error;
    }

    const rows = await this.#sql.unsafe<ProjectDeletionRow[]>(
      `SELECT
         p.id AS project_id,
         p.code,
         p.name,
         to_char(p.deleted_at AT TIME ZONE 'UTC',
                 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS deleted_at,
         u.id AS deleted_by_id,
         u.name AS deleted_by_name,
         COALESCE(actor.is_admin, false) AS actor_is_admin,
         EXISTS (
           SELECT 1
             FROM app.project_members m
            WHERE m.project_id = p.id
              AND m.user_id = $4::bigint
              AND m.status = 'ACTIVE'
              AND m.role = 'LEADER'
         ) AS actor_is_leader
       FROM app.projects p
       JOIN app.users u ON u.id = p.deleted_by
       LEFT JOIN app.users actor ON actor.id = $4::bigint
      WHERE p.deleted_at IS NOT NULL
        AND (
          $1::timestamptz IS NULL
          OR p.deleted_at < $1::timestamptz
          OR (p.deleted_at = $1::timestamptz AND p.id < $2::bigint)
        )
      ORDER BY p.deleted_at DESC, p.id DESC
      LIMIT $3`,
      [after?.at ?? null, after?.id ?? "0", limit + 1, command.actorUserId],
    );

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const last = pageRows.at(-1);
    const lastCursor =
      last === undefined || !hasMore
        ? null
        : { at: last.deleted_at, id: String(last.project_id) };
    return {
      items: pageRows.map(toItem),
      nextCursor:
        lastCursor === null
          ? null
          : this.#cursor.encode({
              actorUserId: command.actorUserId,
              namespace: PROJECT_DELETION_CURSOR_NAMESPACE,
              projectId: null,
              afterAt: lastCursor.at,
              afterId: lastCursor.id,
            }),
      hasMore,
    };
  }
}
