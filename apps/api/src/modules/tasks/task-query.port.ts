import { Injectable } from "@nestjs/common";
import type { TransactionContext } from "../../database/transaction-context.js";

/** 任务身份、归属、状态与影响功能的稳定读模型。 */
export interface TaskReadModel {
  taskId: number;
  projectId: number;
  moduleId: number;
  featureId: number | null;
  scopeType: "FEATURE" | "MODULE";
  code: string;
  title: string;
  creatorId: number;
  assigneeId: number;
  workStatus: "TODO" | "DONE" | "CANCELED";
  lifecycleStatus: "ACTIVE" | "ARCHIVED" | "INVALID";
  rowVersion: number;
  impactFeatureIds: number[];
}

export type TaskWorkStatus = "TODO" | "DONE" | "CANCELED";
export type TaskLifecycleStatus = "ACTIVE" | "ARCHIVED" | "INVALID";
export type TaskScopeType = "FEATURE" | "MODULE";

/** excludedTaskIds 的条目上限：超限即拒绝，禁止把无界集合带进 SQL 参数。 */
export const TASK_EXCLUDED_IDS_MAX = 1000;

/** listByIds 的 taskIds 条目上限：超限即拒绝，禁止把无界数组带进 SQL 参数。 */
export const TASK_READ_IDS_MAX = 1000;

export type TaskListInputErrorReason =
  "invalid-limit" | "invalid-excluded-task-ids" | "invalid-task-ids";

/** 端口入参越界；调用方（应用层）负责映射为 422。 */
export class TaskListInputError extends Error {
  readonly reason: TaskListInputErrorReason;

  constructor(reason: TaskListInputErrorReason, message: string) {
    super(message);
    this.name = "TaskListInputError";
    this.reason = reason;
  }
}

export interface TaskListFilter {
  /**
   * 服务端生成的授权项目范围（AuthorizedProjectScope.projectIds）。端口不校验
   * 成员关系；空数组必须短路返回空集，不得退化为无 WHERE 的全表扫描。
   */
  readonly projectIds: readonly number[];
  readonly assigneeId?: number;
  readonly workStatuses?: readonly TaskWorkStatus[];
  readonly scopeTypes?: readonly TaskScopeType[];
  /**
   * 功能设计 §29.1「有效任务」中 B 侧可表达的部分：
   * lifecycle_status <> 'INVALID' AND work_status <> 'CANCELED'。
   * 「不是历史来源分支」在 C 域，由调用方通过 excludedTaskIds 传入。
   */
  readonly effectiveOnly?: boolean;
  /**
   * C 域算出的排除集合（历史来源分支的任务 ID）。必须在同一条 SQL 内于分页前
   * 应用（A 裁决 §6 冲突 B）；长度上限 TASK_EXCLUDED_IDS_MAX，超限抛
   * TaskListInputError。
   */
  readonly excludedTaskIds?: readonly number[];
}

export interface TaskListPageInput extends TaskListFilter {
  /** 1..100，上限由契约层拒绝；端口只校验正整数。 */
  readonly limit: number;
  /** 上一页返回的 nextTaskId；缺省表示第一页。端口只接收已解码的游标位置。 */
  readonly afterTaskId?: number;
}

export interface TaskListRow {
  readonly taskId: number;
  readonly projectId: number;
  readonly moduleId: number;
  readonly featureId: number | null;
  readonly scopeType: TaskScopeType;
  readonly code: string;
  readonly title: string;
  readonly assigneeId: number;
  readonly workStatus: TaskWorkStatus;
  readonly lifecycleStatus: TaskLifecycleStatus;
  readonly rowVersion: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface TaskListPage {
  readonly items: readonly TaskListRow[];
  /** 还有下一页时为最后一条的 id（下一页游标签名的 keyset 位置），否则为 null。 */
  readonly nextTaskId: number | null;
  readonly hasMore: boolean;
}

/**
 * 当前 Drizzle + postgres-js 组合把时间类型解析器覆盖成透传，时间列以文本返回；
 * 适配器在边界统一还原为 Date，保证端口签名与运行时行为一致。
 */
export interface TaskListRowRaw extends Omit<
  TaskListRow,
  "createdAt" | "updatedAt"
> {
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function mapTaskListRow(row: TaskListRowRaw): TaskListRow {
  return {
    ...row,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

/** Caller authorizes the project. lock requires project/module/sorted feature locks first. */
export abstract class TaskQueryPort {
  /**
   * 项目无关的预读，供请求只携带任务 ID、需要先解析真实归属的命令使用。
   * 预读结果不得用于写决策：取得父级与任务锁后必须重新读取；
   * 跨项目或不可访问的统一按不存在处理。
   */
  abstract findByTaskId(
    tx: TransactionContext,
    taskId: number,
  ): Promise<TaskReadModel | undefined>;
  abstract find(
    tx: TransactionContext,
    projectId: number,
    taskId: number,
  ): Promise<TaskReadModel | undefined>;
  abstract lock(
    tx: TransactionContext,
    projectId: number,
    taskId: number,
  ): Promise<TaskReadModel | undefined>;

  /**
   * 批量按 ID 读取（R-1 聚合组成员、R-4 记录来源标签）。只读、不取锁。
   *
   * 约定：
   * 1. projectIds 与 taskIds 任一为空时短路返回空集，不发出任何 SQL。
   * 2. SQL 同时带 project_id 与 id 条件，跨项目串联不会返回结果；
   *    调用方必须先把两者限制在服务端授权范围内。
   * 3. taskIds 上限 TASK_READ_IDS_MAX，超限抛 TaskListInputError。
   */
  abstract listByIds(
    tx: TransactionContext,
    projectIds: readonly number[],
    taskIds: readonly number[],
  ): Promise<readonly TaskReadModel[]>;

  /**
   * 跨项目分页列表（F-29 未完成任务、F-32 我的任务）。只读、不取锁。
   *
   * 约定：
   * 1. projectIds 必须来自服务端生成的 AuthorizedProjectScope；端口不校验成员关系。
   * 2. projectIds 为空时短路返回空页，不发出任何 SQL。
   * 3. 排序固定 ORDER BY t.id DESC，稳定且命中 tasks_project_status_idx /
   *    tasks_assignee_status_idx 的末列，不需要新增迁移。
   * 4. excludedTaskIds 在分页前过滤，保证先过滤后分页。
   * 5. 游标签名不属于端口职责：调用方解码游标后传入 afterTaskId，并用返回的
   *    nextTaskId 自行签发（与 ActivityProjectionReader + TimeCursorService 同一分工）。
   * 6. 记录维度筛选（是否有正式记录）需要 change_records，本端口不承载，见
   *    MyTaskQueryPort（A 裁决 §6 冲突 A）。
   */
  abstract list(
    tx: TransactionContext,
    input: TaskListPageInput,
  ): Promise<TaskListPage>;

  /** 与 list 同口径的不分页计数（F-29「未完成任务」）。只读、不取锁。 */
  abstract count(
    tx: TransactionContext,
    filter: TaskListFilter,
  ): Promise<number>;
}

function assertLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new TaskListInputError(
      "invalid-limit",
      "task list limit must be a positive integer",
    );
  }
}

function assertReadTaskIds(taskIds: readonly number[]): void {
  if (taskIds.length > TASK_READ_IDS_MAX) {
    throw new TaskListInputError(
      "invalid-task-ids",
      `taskIds exceeds the ${TASK_READ_IDS_MAX} entry limit`,
    );
  }
  for (const taskId of taskIds) {
    if (!Number.isSafeInteger(taskId) || taskId <= 0) {
      throw new TaskListInputError(
        "invalid-task-ids",
        "taskIds must contain positive integers",
      );
    }
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
export class PostgresTaskQueryPort extends TaskQueryPort {
  async findByTaskId(tx: TransactionContext, taskId: number) {
    const [row] = await tx.sql<
      TaskReadModel[]
    >`SELECT id AS "taskId",project_id AS "projectId",module_id AS "moduleId",feature_id AS "featureId",scope_type AS "scopeType",code,title,creator_id AS "creatorId",assignee_id AS "assigneeId",work_status AS "workStatus",lifecycle_status AS "lifecycleStatus",row_version AS "rowVersion",
      ARRAY(SELECT feature_id FROM app.task_feature_impacts WHERE task_id=app.tasks.id ORDER BY feature_id) AS "impactFeatureIds" FROM app.tasks WHERE id=${taskId}`;
    return row;
  }
  async find(tx: TransactionContext, projectId: number, taskId: number) {
    const [row] = await tx.sql<
      TaskReadModel[]
    >`SELECT id AS "taskId",project_id AS "projectId",module_id AS "moduleId",feature_id AS "featureId",scope_type AS "scopeType",code,title,creator_id AS "creatorId",assignee_id AS "assigneeId",work_status AS "workStatus",lifecycle_status AS "lifecycleStatus",row_version AS "rowVersion",
      ARRAY(SELECT feature_id FROM app.task_feature_impacts WHERE task_id=app.tasks.id ORDER BY feature_id) AS "impactFeatureIds" FROM app.tasks WHERE id=${taskId} AND project_id=${projectId}`;
    return row;
  }
  async lock(tx: TransactionContext, projectId: number, taskId: number) {
    await tx.sql`SELECT id FROM app.tasks WHERE id=${taskId} AND project_id=${projectId} FOR UPDATE`;
    // Separate READ COMMITTED statement sees relationships committed while waiting for the row.
    return this.find(tx, projectId, taskId);
  }

  async listByIds(
    tx: TransactionContext,
    projectIds: readonly number[],
    taskIds: readonly number[],
  ): Promise<readonly TaskReadModel[]> {
    assertReadTaskIds(taskIds);
    if (projectIds.length === 0 || taskIds.length === 0) {
      return [];
    }
    const projects = [...projectIds];
    const tasks = [...taskIds];
    return (await tx.sql<
      TaskReadModel[]
    >`SELECT id AS "taskId",project_id AS "projectId",module_id AS "moduleId",feature_id AS "featureId",scope_type AS "scopeType",code,title,creator_id AS "creatorId",assignee_id AS "assigneeId",work_status AS "workStatus",lifecycle_status AS "lifecycleStatus",row_version AS "rowVersion",
      ARRAY(SELECT feature_id FROM app.task_feature_impacts WHERE task_id=app.tasks.id ORDER BY feature_id) AS "impactFeatureIds" FROM app.tasks WHERE project_id = ANY(${projects}::integer[]) AND id = ANY(${tasks}::integer[]) ORDER BY id ASC`) as unknown as readonly TaskReadModel[];
  }

  async list(
    tx: TransactionContext,
    input: TaskListPageInput,
  ): Promise<TaskListPage> {
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

    const rows = await tx.sql<TaskListRowRaw[]>`
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
             t.updated_at AS "updatedAt"
        FROM app.tasks t
       WHERE t.project_id = ANY(${projectIds}::integer[])
         AND (${assigneeId}::integer IS NULL OR t.assignee_id = ${assigneeId})
         AND (${workStatuses}::text[] IS NULL OR t.work_status = ANY(${workStatuses}::text[]))
         AND (${scopeTypes}::text[] IS NULL OR t.scope_type = ANY(${scopeTypes}::text[]))
         AND (${effectiveOnly}::boolean = false OR (t.lifecycle_status <> 'INVALID' AND t.work_status <> 'CANCELED'))
         AND (${excludedTaskIds}::integer[] IS NULL OR t.id <> ALL(${excludedTaskIds}::integer[]))
         AND (${afterTaskId}::integer IS NULL OR t.id < ${afterTaskId})
       ORDER BY t.id DESC
       LIMIT ${input.limit + 1}
    `;
    const hasMore = rows.length > input.limit;
    const items = (hasMore ? rows.slice(0, input.limit) : rows).map(
      mapTaskListRow,
    );
    const last = items.length === 0 ? null : items[items.length - 1];
    return {
      items,
      hasMore,
      nextTaskId: hasMore && last ? last.taskId : null,
    };
  }

  async count(tx: TransactionContext, filter: TaskListFilter): Promise<number> {
    assertExcludedTaskIds(filter.excludedTaskIds);
    if (filter.projectIds.length === 0) {
      return 0;
    }
    const projectIds = [...filter.projectIds];
    const assigneeId = filter.assigneeId ?? null;
    const workStatuses = filter.workStatuses ? [...filter.workStatuses] : null;
    const scopeTypes = filter.scopeTypes ? [...filter.scopeTypes] : null;
    const effectiveOnly = filter.effectiveOnly === true;
    const excludedTaskIds = filter.excludedTaskIds
      ? [...filter.excludedTaskIds]
      : null;

    const [row] = await tx.sql<{ total: number }[]>`
      SELECT COUNT(*)::integer AS total
        FROM app.tasks t
       WHERE t.project_id = ANY(${projectIds}::integer[])
         AND (${assigneeId}::integer IS NULL OR t.assignee_id = ${assigneeId})
         AND (${workStatuses}::text[] IS NULL OR t.work_status = ANY(${workStatuses}::text[]))
         AND (${scopeTypes}::text[] IS NULL OR t.scope_type = ANY(${scopeTypes}::text[]))
         AND (${effectiveOnly}::boolean = false OR (t.lifecycle_status <> 'INVALID' AND t.work_status <> 'CANCELED'))
         AND (${excludedTaskIds}::integer[] IS NULL OR t.id <> ALL(${excludedTaskIds}::integer[]))
    `;
    return row?.total ?? 0;
  }
}
