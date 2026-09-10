import { Injectable } from "@nestjs/common";
import type { TransactionContext } from "../../database/transaction-context.js";
import type { TaskScopeType } from "../tasks/index.js";

/** 列表条数上限：契约层已按 A 裁决 Q-06 收口到 1..10，端口再兜一层。 */
export const CHANGE_RECORD_READ_LIMIT_MAX = 100;

/** listTaskIdsWithPublishedRecords 的 taskIds 上限，避免无界数组进入 SQL 参数。 */
export const CHANGE_RECORD_TASK_IDS_MAX = 1000;

export type ChangeRecordReadInputErrorReason =
  "invalid-limit" | "invalid-task-ids";

/** 端口入参越界；调用方（应用层）负责映射为 422。 */
export class ChangeRecordReadInputError extends Error {
  readonly reason: ChangeRecordReadInputErrorReason;

  constructor(reason: ChangeRecordReadInputErrorReason, message: string) {
    super(message);
    this.name = "ChangeRecordReadInputError";
    this.reason = reason;
  }
}

export interface RecordCountInput {
  readonly projectId: number;
  /** 省略 = 项目内全部模块。 */
  readonly moduleId?: number;
  /** 省略 = 项目内全部功能。 */
  readonly featureId?: number;
  /** 省略 = 功能级与模块级记录都计入。 */
  readonly scopeType?: TaskScopeType;
}

export interface RecentRecordItem {
  readonly recordId: number;
  readonly projectId: number;
  readonly moduleId: number;
  readonly featureId: number | null;
  readonly code: string;
  readonly title: string;
  readonly currentVersion: number;
  readonly publishedAt: Date;
  /** 所属功能名；模块级记录为 null。 */
  readonly featureName: string | null;
}

export interface LeftoverItemSummary {
  readonly leftoverItemId: number;
  readonly recordId: number;
  /** 记录编号；PUBLISHED / VOID 记录的 code 非空（0000 的 state CHECK）。 */
  readonly recordCode: string;
  readonly projectId: number;
  readonly content: string;
  readonly createdAt: Date;
}

/**
 * 当前 Drizzle + postgres-js 组合把时间类型解析器覆盖成透传，时间列以文本返回；
 * 适配器在边界统一还原为 Date，保证端口签名与运行时行为一致。
 */
interface RecentRecordRowRaw extends Omit<RecentRecordItem, "publishedAt"> {
  readonly publishedAt: string;
}

interface LeftoverItemRowRaw extends Omit<LeftoverItemSummary, "createdAt"> {
  readonly createdAt: string;
}
/**
 * 记录域（B）的项目维度只读聚合端口，服务 F-29 项目概览与 R-1 / R-3 的记录维度。
 *
 * 约定：
 * 1. 只读、不取锁；不校验项目授权，调用方必须先取得 AuthorizedProjectScope。
 * 2. 统计口径按功能设计 §29.4：计数基于 change_records（不按版本计数），
 *    也不 join change_record_feature_impacts（模块级记录被多个功能引用时仍计 1 条）。
 * 3. 记录可见性按 A 裁决 Q-13：只有 PUBLISHED 与 VOID 可见，DRAFT 不可见。
 */
export abstract class ChangeRecordReadPort {
  /** F-29 迭代记录数：只计 status = PUBLISHED，VOID / DRAFT 不计。 */
  abstract countPublished(
    tx: TransactionContext,
    input: RecordCountInput,
  ): Promise<number>;

  /** F-29 最近迭代：只计 PUBLISHED，按 published_at DESC, id DESC 稳定排序。 */
  abstract listRecentPublished(
    tx: TransactionContext,
    input: RecordCountInput & { readonly limit: number },
  ): Promise<readonly RecentRecordItem[]>;

  /**
   * F-29 待处理遗留问题：只取 status = ACTIVE，且记录本身对当前产品可见
   * （PUBLISHED / VOID）。按 created_at DESC, id DESC 稳定排序。
   */
  abstract listActiveLeftovers(
    tx: TransactionContext,
    input: RecordCountInput & { readonly limit: number },
  ): Promise<readonly LeftoverItemSummary[]>;

  /**
   * 给定项目范围（可选任务集合），返回其中已有正式（PUBLISHED）记录的任务 ID。
   * 服务 R-1 成员项的 publishedRecordCount 与任务记录维度标记。
   *
   * projectIds 为空返回空数组，不发出 SQL；taskIds 省略表示不限任务，传入空数组
   * 表示没有候选任务、同样返回空数组。
   */
  abstract listTaskIdsWithPublishedRecords(
    tx: TransactionContext,
    projectIds: readonly number[],
    taskIds?: readonly number[],
  ): Promise<readonly number[]>;
}

function assertLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new ChangeRecordReadInputError(
      "invalid-limit",
      "change record read limit must be a positive integer",
    );
  }
  if (limit > CHANGE_RECORD_READ_LIMIT_MAX) {
    throw new ChangeRecordReadInputError(
      "invalid-limit",
      `limit exceeds CHANGE_RECORD_READ_LIMIT_MAX (${CHANGE_RECORD_READ_LIMIT_MAX})`,
    );
  }
}

function assertTaskIds(taskIds: readonly number[] | undefined): void {
  if (taskIds === undefined) {
    return;
  }
  if (taskIds.length > CHANGE_RECORD_TASK_IDS_MAX) {
    throw new ChangeRecordReadInputError(
      "invalid-task-ids",
      `taskIds exceeds CHANGE_RECORD_TASK_IDS_MAX (${CHANGE_RECORD_TASK_IDS_MAX}) entries`,
    );
  }
  for (const taskId of taskIds) {
    if (!Number.isSafeInteger(taskId) || taskId <= 0) {
      throw new ChangeRecordReadInputError(
        "invalid-task-ids",
        "taskIds must contain positive integers",
      );
    }
  }
}

@Injectable()
export class PostgresChangeRecordReadPort extends ChangeRecordReadPort {
  async countPublished(
    tx: TransactionContext,
    input: RecordCountInput,
  ): Promise<number> {
    const moduleId = input.moduleId ?? null;
    const featureId = input.featureId ?? null;
    const scopeType = input.scopeType ?? null;
    const [row] = await tx.sql<{ total: number }[]>`
      SELECT COUNT(*)::integer AS total
        FROM app.change_records cr
       WHERE cr.project_id = ${input.projectId}
         AND cr.status = 'PUBLISHED'
         AND (${moduleId}::integer IS NULL OR cr.module_id = ${moduleId})
         AND (${featureId}::integer IS NULL OR cr.feature_id = ${featureId})
         AND (${scopeType}::text IS NULL OR cr.scope_type = ${scopeType})
    `;
    return row?.total ?? 0;
  }

  async listRecentPublished(
    tx: TransactionContext,
    input: RecordCountInput & { readonly limit: number },
  ): Promise<readonly RecentRecordItem[]> {
    assertLimit(input.limit);
    const moduleId = input.moduleId ?? null;
    const featureId = input.featureId ?? null;
    const scopeType = input.scopeType ?? null;
    const rows = await tx.sql<RecentRecordRowRaw[]>`
      SELECT cr.id AS "recordId",
             cr.project_id AS "projectId",
             cr.module_id AS "moduleId",
             cr.feature_id AS "featureId",
             cr.code AS code,
             cr.title AS title,
             cr.current_version AS "currentVersion",
             cr.published_at AS "publishedAt",
             f.name AS "featureName"
        FROM app.change_records cr
        LEFT JOIN app.features f
          ON f.id = cr.feature_id
         AND f.module_id = cr.module_id
         AND f.project_id = cr.project_id
       WHERE cr.project_id = ${input.projectId}
         AND cr.status = 'PUBLISHED'
         AND (${moduleId}::integer IS NULL OR cr.module_id = ${moduleId})
         AND (${featureId}::integer IS NULL OR cr.feature_id = ${featureId})
         AND (${scopeType}::text IS NULL OR cr.scope_type = ${scopeType})
       ORDER BY cr.published_at DESC, cr.id DESC
       LIMIT ${input.limit}
    `;
    return rows.map((row) => ({
      ...row,
      publishedAt: new Date(row.publishedAt),
    }));
  }

  async listActiveLeftovers(
    tx: TransactionContext,
    input: RecordCountInput & { readonly limit: number },
  ): Promise<readonly LeftoverItemSummary[]> {
    assertLimit(input.limit);
    const moduleId = input.moduleId ?? null;
    const featureId = input.featureId ?? null;
    const scopeType = input.scopeType ?? null;
    const rows = await tx.sql<LeftoverItemRowRaw[]>`
      SELECT li.id AS "leftoverItemId",
             li.record_id AS "recordId",
             cr.code AS "recordCode",
             li.project_id AS "projectId",
             vl.content_snapshot AS content,
             li.created_at AS "createdAt"
        FROM app.change_record_leftover_items li
        JOIN app.change_records cr
          ON cr.id = li.record_id
         AND cr.project_id = li.project_id
         AND cr.status IN ('PUBLISHED', 'VOID')
        JOIN LATERAL (
          SELECT v.content_snapshot
            FROM app.change_record_version_leftovers v
           WHERE v.leftover_item_id = li.id
             AND v.record_id = li.record_id
             AND v.project_id = li.project_id
           ORDER BY v.version_no DESC
           LIMIT 1
        ) vl ON TRUE
       WHERE li.project_id = ${input.projectId}
         AND li.status = 'ACTIVE'
         AND (${moduleId}::integer IS NULL OR cr.module_id = ${moduleId})
         AND (${featureId}::integer IS NULL OR cr.feature_id = ${featureId})
         AND (${scopeType}::text IS NULL OR cr.scope_type = ${scopeType})
       ORDER BY li.created_at DESC, li.id DESC
       LIMIT ${input.limit}
    `;
    return rows.map((row) => ({
      ...row,
      createdAt: new Date(row.createdAt),
    }));
  }

  async listTaskIdsWithPublishedRecords(
    tx: TransactionContext,
    projectIds: readonly number[],
    taskIds?: readonly number[],
  ): Promise<readonly number[]> {
    assertTaskIds(taskIds);
    if (projectIds.length === 0 || taskIds?.length === 0) {
      return [];
    }
    const projects = [...projectIds];
    const tasks = taskIds ? [...taskIds] : null;
    const rows = await tx.sql<{ taskId: number }[]>`
      SELECT DISTINCT cr.task_id AS "taskId"
        FROM app.change_records cr
       WHERE cr.project_id = ANY(${projects}::integer[])
         AND cr.status = 'PUBLISHED'
         AND cr.task_id IS NOT NULL
         AND (${tasks}::integer[] IS NULL OR cr.task_id = ANY(${tasks}::integer[]))
       ORDER BY 1
    `;
    return rows.map((row) => row.taskId);
  }
}
