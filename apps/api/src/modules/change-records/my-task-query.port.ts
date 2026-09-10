import { Injectable } from "@nestjs/common";
import type { TransactionContext } from "../../database/transaction-context.js";
import {
  mapTaskListRow,
  TASK_EXCLUDED_IDS_MAX,
  TaskListInputError,
  type TaskListFilter,
  type TaskListPage,
  type TaskListRowRaw,
} from "../tasks/index.js";

export interface MyTaskPageInput extends TaskListFilter {
  /** 1..100，上限由契约层拒绝；端口只校验正整数。 */
  readonly limit: number;
  /** 上一页返回的 nextTaskId；缺省表示第一页。端口只接收已解码的游标位置。 */
  readonly afterTaskId?: number;
  /**
   * 记录维度筛选（R-3 的 hasPublishedRecord）：
   * true = 只返回已有 PUBLISHED 记录的任务；false = 只返回没有的；缺省 = 不筛选。
   */
  readonly hasPublishedRecord?: boolean;
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
 * 4. excludedTaskIds（C 域的历史来源分支）与 hasPublishedRecord 都在分页前过滤。
 * 5. 游标签名不属于端口职责：调用方解码游标后传入 afterTaskId，并用返回的
 *    nextTaskId 自行签发（C-006 / Q-10：绑定 actor 与筛选条件、TTL 15 分钟）。
 */
export abstract class MyTaskQueryPort {
  abstract list(
    tx: TransactionContext,
    input: MyTaskPageInput,
  ): Promise<TaskListPage>;
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
    const hasPublishedRecord =
      input.hasPublishedRecord === undefined
        ? null
        : input.hasPublishedRecord === true;

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
      mapTaskListRow,
    );
    const last = items.length === 0 ? null : items[items.length - 1];
    return {
      items,
      hasMore,
      nextTaskId: hasMore && last ? last.taskId : null,
    };
  }
}
