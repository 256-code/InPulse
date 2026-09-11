import { Injectable } from "@nestjs/common";
import type { TransactionContext } from "../../database/transaction-context.js";
import {
  mapTaskListRow,
  TASK_EXCLUDED_IDS_MAX,
  TaskListInputError,
  type TaskListFilter,
  type TaskListRow,
} from "../tasks/index.js";

/** R-3 任务优先级；与 app.tasks.tasks_priority_check 的取值一致（A 裁决 §10.3）。 */
export type MyTaskPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

export interface MyTaskPageInput extends TaskListFilter {
  /** 1..100，上限由契约层拒绝；端口只校验正整数。 */
  readonly limit: number;
  /** 上一页返回的 nextTaskId；缺省表示第一页。端口只接收已解码的游标位置。 */
  readonly afterTaskId?: number;
  /**
   * 记录维度筛选（R-3 的 hasPublishedRecord）：
   * true = 只返回已有 PUBLISHED 记录的任务；false = 只返回没有的；缺省 = 不筛选。
   * 与 ChangeRecordReadPort.countPublishedByTask 同源同口径（等价 count > 0），
   * 仍在下方同一分页 SQL 内先过滤后分页（裁决修订 D-1 / §11.6）。
   */
  readonly hasPublishedRecord?: boolean;
  /** 单值优先级筛选；与 workStatus 正交（A 裁决 §10.3）。 */
  readonly priority?: MyTaskPriority;
}

/**
 * R-3 列表行：在 TaskListRow 之上补齐 A 裁决 §10.3 要求的选择列。
 * 时间列在适配器边界统一还原为 Date（与 TaskListRow 同一约定）。
 */
export interface MyTaskListRow extends TaskListRow {
  readonly priority: MyTaskPriority;
  /** null = 未设置截止；与骨架的 undefined（不可知）语义不同。 */
  readonly dueAt: Date | null;
  /** 与 work_status = 'DONE' 同真（tasks_completion_state_check）。 */
  readonly completedAt: Date | null;
  readonly creatorId: number;
}

/** R-3 分页结果；nextTaskId 语义与 TaskListPage 相同。 */
export interface MyTaskListPage {
  readonly items: readonly MyTaskListRow[];
  readonly nextTaskId: number | null;
  readonly hasMore: boolean;
}

interface MyTaskListRowRaw extends Omit<
  MyTaskListRow,
  "createdAt" | "updatedAt" | "dueAt" | "completedAt"
> {
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly dueAt: string | null;
  readonly completedAt: string | null;
}

function mapMyTaskListRow(row: MyTaskListRowRaw): MyTaskListRow {
  return {
    ...mapTaskListRow(row),
    priority: row.priority,
    dueAt: row.dueAt === null ? null : new Date(row.dueAt),
    completedAt: row.completedAt === null ? null : new Date(row.completedAt),
    creatorId: row.creatorId,
  };
}

/**
 * R-3 统计基准集合入参（A 裁决 §10.3）：projectIds 已按 projectId 参数收窄，
 * excludedTaskIds 为 C 域历史来源分支；分页与游标不影响统计。
 */
export interface MyTaskBaseSetInput {
  readonly projectIds: readonly number[];
  readonly assigneeId: number;
  readonly excludedTaskIds?: readonly number[];
}

/** R-3 四项统计；同一条 SQL 内以 FILTER 聚合，日界/月界由 SQL 按 Asia/Shanghai 计算。 */
export interface MyTaskStatsResult {
  readonly myOpen: number;
  readonly dueToday: number;
  readonly overdue: number;
  readonly completedThisMonth: number;
}

/** R-3 遗留问题样例：contentPrefix 为最新版本 content 的前 200 字符。 */
export interface MyTaskLeftoverSampleRow {
  readonly recordCode: string;
  readonly contentPrefix: string;
  readonly truncated: boolean;
}

/** R-3 遗留问题入口：基准集合任务关联的 ACTIVE 遗留项去重计数与最新一条。 */
export interface MyTaskLeftoverEntry {
  readonly count: number;
  readonly sample: MyTaskLeftoverSampleRow | null;
}

/**
 * F-32 / R-3「我的任务」分页查询端口。
 *
 * 宿主为什么在记录侧（A 裁决 §6 冲突 A）：本查询必须同时读 app.tasks 与
 * app.change_records，并保证「先过滤后分页」的单条 SQL。放在 TasksModule 会让
 * TasksModule 依赖 ChangeRecordsModule，与已存在的
 * ChangeRecordsModule -> TaskQueryPort（record-publication-access.ts）形成双向依赖，
 * 且技术设计 §5.3 明确 TasksModule 不反向持有记录外键。记录侧已依赖 TasksModule，
 * 宿主放这里不反转任何既有方向，也不新增依赖环。
 *
 * 约定：
 * 1. 只读、不取锁；不校验项目授权，调用方必须先取得 AuthorizedProjectScope。
 * 2. projectIds 为空时短路返回空页，不发出任何 SQL。
 * 3. 排序固定 ORDER BY t.id DESC，与 TaskQueryPort.list 同口径。
 * 4. excludedTaskIds（C 域的历史来源分支）与 hasPublishedRecord 都在分页前过滤；
 *    计数映射（countPublishedByTask）只在分页后按本页 taskIds 补齐，不参与、也不
 *    替代筛选，确保先过滤后分页不被破坏（裁决修订 D-1）。
 * 5. 游标签名不属于端口职责：调用方解码游标后传入 afterTaskId，并用返回的
 *    nextTaskId 自行签发（C-006 / Q-10：绑定 actor 与筛选条件、TTL 15 分钟）。
 */
export abstract class MyTaskQueryPort {
  abstract list(
    tx: TransactionContext,
    input: MyTaskPageInput,
  ): Promise<MyTaskListPage>;

  /**
   * R-3 统计卡片（A 裁决 §10.3）：与列表同一基准集合（负责人 + projectId +
   * 有效任务 + 历史来源分支排除），分页与游标不影响计数。
   */
  abstract stats(
    tx: TransactionContext,
    input: MyTaskBaseSetInput,
  ): Promise<MyTaskStatsResult>;

  /**
   * R-3 遗留问题入口：基准集合任务经 leftover_task_links 关联的 ACTIVE 遗留项
   * 去重计数与最新一条样例（created_at DESC, id DESC）。
   */
  abstract leftoverEntry(
    tx: TransactionContext,
    input: MyTaskBaseSetInput,
  ): Promise<MyTaskLeftoverEntry>;
}

function assertLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new TaskListInputError(
      "invalid-limit",
      "my task list limit must be a positive integer",
    );
  }
}

function assertExcludedTaskIds(
  excludedTaskIds: readonly number[] | undefined,
): void {
  if (excludedTaskIds === undefined) {
    return;
  }
  if (excludedTaskIds.length > TASK_EXCLUDED_IDS_MAX) {
    throw new TaskListInputError(
      "invalid-excluded-task-ids",
      `excludedTaskIds exceeds the ${TASK_EXCLUDED_IDS_MAX} entry limit`,
    );
  }
  for (const taskId of excludedTaskIds) {
    if (!Number.isSafeInteger(taskId) || taskId <= 0) {
      throw new TaskListInputError(
        "invalid-excluded-task-ids",
        "excludedTaskIds must contain positive integers",
      );
    }
  }
}

@Injectable()
export class PostgresMyTaskQueryPort extends MyTaskQueryPort {
  async list(
    tx: TransactionContext,
    input: MyTaskPageInput,
  ): Promise<MyTaskListPage> {
    assertLimit(input.limit);
    assertExcludedTaskIds(input.excludedTaskIds);
    if (input.projectIds.length === 0) {
      return { items: [], nextTaskId: null, hasMore: false };
    }
    const projectIds = [...input.projectIds];
    const assigneeId = input.assigneeId ?? null;
    const workStatuses = input.workStatuses ? [...input.workStatuses] : null;
    const scopeTypes = input.scopeTypes ? [...input.scopeTypes] : null;
    const effectiveOnly = input.effectiveOnly === true;
    const excludedTaskIds = input.excludedTaskIds
      ? [...input.excludedTaskIds]
      : null;
    const afterTaskId = input.afterTaskId ?? null;
    const priority = input.priority ?? null;
    const hasPublishedRecord =
      input.hasPublishedRecord === undefined
        ? null
        : input.hasPublishedRecord === true;

    const rows = await tx.sql<MyTaskListRowRaw[]>`
      SELECT t.id AS "taskId",
             t.project_id AS "projectId",
             t.module_id AS "moduleId",
             t.feature_id AS "featureId",
             t.scope_type AS "scopeType",
             t.code,
             t.title,
             t.assignee_id AS "assigneeId",
             t.work_status AS "workStatus",
             t.lifecycle_status AS "lifecycleStatus",
             t.row_version AS "rowVersion",
             t.created_at AS "createdAt",
             t.updated_at AS "updatedAt",
             t.priority AS priority,
             t.due_at AS "dueAt",
             t.completed_at AS "completedAt",
             t.creator_id AS "creatorId"
        FROM app.tasks t
       WHERE t.project_id = ANY(${projectIds}::integer[])
         AND (${assigneeId}::integer IS NULL OR t.assignee_id = ${assigneeId})
         AND (${workStatuses}::text[] IS NULL OR t.work_status = ANY(${workStatuses}::text[]))
         AND (${scopeTypes}::text[] IS NULL OR t.scope_type = ANY(${scopeTypes}::text[]))
         AND (${priority}::text IS NULL OR t.priority = ${priority})
         AND (${effectiveOnly}::boolean = false OR (t.lifecycle_status <> 'INVALID' AND t.work_status <> 'CANCELED'))
         AND (${excludedTaskIds}::integer[] IS NULL OR t.id <> ALL(${excludedTaskIds}::integer[]))
         AND (${hasPublishedRecord}::boolean IS NULL
              OR EXISTS (
                   SELECT 1
                     FROM app.change_records cr
                    WHERE cr.project_id = t.project_id
                      AND cr.task_id = t.id
                      AND cr.status = 'PUBLISHED'
                 ) = ${hasPublishedRecord})
         AND (${afterTaskId}::integer IS NULL OR t.id < ${afterTaskId})
       ORDER BY t.id DESC
       LIMIT ${input.limit + 1}
    `;
    const hasMore = rows.length > input.limit;
    const items = (hasMore ? rows.slice(0, input.limit) : rows).map(
      mapMyTaskListRow,
    );
    const last = items.length === 0 ? null : items[items.length - 1];
    return {
      items,
      hasMore,
      nextTaskId: hasMore && last ? last.taskId : null,
    };
  }

  async stats(
    tx: TransactionContext,
    input: MyTaskBaseSetInput,
  ): Promise<MyTaskStatsResult> {
    assertExcludedTaskIds(input.excludedTaskIds);
    if (input.projectIds.length === 0) {
      return { myOpen: 0, dueToday: 0, overdue: 0, completedThisMonth: 0 };
    }
    const projectIds = [...input.projectIds];
    const excludedTaskIds = input.excludedTaskIds
      ? [...input.excludedTaskIds]
      : null;
    const [row] = await tx.sql<MyTaskStatsResult[]>`
      SELECT (COUNT(*) FILTER (WHERE t.work_status = 'TODO'))::integer AS "myOpen",
             (COUNT(*) FILTER (
               WHERE t.work_status = 'TODO'
                 AND t.due_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai'
                 AND t.due_at < (date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') + interval '1 day') AT TIME ZONE 'Asia/Shanghai'
             ))::integer AS "dueToday",
             (COUNT(*) FILTER (
               WHERE t.work_status = 'TODO'
                 AND t.due_at < now()
             ))::integer AS "overdue",
             (COUNT(*) FILTER (
               WHERE t.work_status = 'DONE'
                 AND t.completed_at >= date_trunc('month', now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai'
                 AND t.completed_at < (date_trunc('month', now() AT TIME ZONE 'Asia/Shanghai') + interval '1 month') AT TIME ZONE 'Asia/Shanghai'
             ))::integer AS "completedThisMonth"
        FROM app.tasks t
       WHERE t.project_id = ANY(${projectIds}::integer[])
         AND t.assignee_id = ${input.assigneeId}
         AND t.lifecycle_status <> 'INVALID'
         AND t.work_status <> 'CANCELED'
         AND (${excludedTaskIds}::integer[] IS NULL OR t.id <> ALL(${excludedTaskIds}::integer[]))
    `;
    return row ?? { myOpen: 0, dueToday: 0, overdue: 0, completedThisMonth: 0 };
  }

  async leftoverEntry(
    tx: TransactionContext,
    input: MyTaskBaseSetInput,
  ): Promise<MyTaskLeftoverEntry> {
    assertExcludedTaskIds(input.excludedTaskIds);
    if (input.projectIds.length === 0) {
      return { count: 0, sample: null };
    }
    const projectIds = [...input.projectIds];
    const excludedTaskIds = input.excludedTaskIds
      ? [...input.excludedTaskIds]
      : null;
    const [row] = await tx.sql<MyTaskLeftoverRowRaw[]>`
      WITH base AS (
        SELECT t.id AS task_id, t.project_id
          FROM app.tasks t
         WHERE t.project_id = ANY(${projectIds}::integer[])
           AND t.assignee_id = ${input.assigneeId}
           AND t.lifecycle_status <> 'INVALID'
           AND t.work_status <> 'CANCELED'
           AND (${excludedTaskIds}::integer[] IS NULL OR t.id <> ALL(${excludedTaskIds}::integer[]))
      ),
      candidates AS (
        SELECT li.id,
               li.created_at,
               cr.code AS record_code,
               left(vl.content_snapshot, 200) AS content_prefix,
               (length(vl.content_snapshot) > 200) AS truncated
          FROM base b
          JOIN app.leftover_task_links ltl
            ON ltl.task_id = b.task_id
           AND ltl.project_id = b.project_id
          JOIN app.change_record_leftover_items li
            ON li.id = ltl.leftover_item_id
           AND li.project_id = ltl.project_id
           AND li.status = 'ACTIVE'
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
      )
      SELECT (SELECT COUNT(*)::integer FROM candidates) AS "count",
             sample."recordCode",
             sample."contentPrefix",
             sample.truncated
        FROM (SELECT 1) AS one
        LEFT JOIN LATERAL (
          SELECT record_code AS "recordCode",
                 content_prefix AS "contentPrefix",
                 truncated AS truncated
            FROM candidates
           ORDER BY created_at DESC, id DESC
           LIMIT 1
        ) AS sample ON TRUE
    `;
    if (row === undefined) {
      return { count: 0, sample: null };
    }
    return {
      count: row.count,
      sample:
        row.recordCode === null || row.contentPrefix === null
          ? null
          : {
              recordCode: row.recordCode,
              contentPrefix: row.contentPrefix,
              truncated: row.truncated === true,
            },
    };
  }
}

interface MyTaskLeftoverRowRaw {
  readonly count: number;
  readonly recordCode: string | null;
  readonly contentPrefix: string | null;
  readonly truncated: boolean | null;
}
