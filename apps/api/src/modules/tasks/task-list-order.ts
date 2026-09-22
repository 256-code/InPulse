import type { Fragment, ISql } from "postgres";

/**
 * 任务列表统一排序键（2026-09-18 人工确认，ADR-037）。
 *
 * 任务中心（MyTaskQueryPort.list）、任务列表端口（TaskQueryPort.list）与任务面板
 * （TaskManagementRepository.list）必须共用本模块，禁止各自定义排序表达式。
 * 所有表达式固定使用别名 t，调用方必须写成 FROM app.tasks t。
 *
 * 排序口径（逐级比较，越靠前越优先）：
 *   1. 状态分组：未完成(0) → 已完成(1) → 已取消(2)
 *   2. 完成时间倒序（仅「已完成」分组有值）：completed_at DESC，未完成 / 已取消用
 *      '-infinity' 归一后恒等、不参与比较。2026-09-22 产品口径「这个排序按照完成
 *      时间，越晚越排前面」，与任务看板 listForBoard 的「已完成按完成时间倒序」对齐；
 *      已完成任务之间因此先看完成时间，优先级 / 截止只做完成时间相同时的兜底。
 *   3. 紧急桶（仅未完成参与，命中第一个）：遗留问题来源(0) → 标记紧急(1) →
 *      已逾期(2) → 今/明日截止(3) → 其余(4)。已逾期排在标记紧急之后是 2026-09-22
 *      产品口径「逾期的不搞特殊了……只是排序靠前，比紧急低一档」：逾期不再整卡
 *      换色，但仍在未完成的普通任务之前。
 *   4. 优先级：紧急(0) → 高(1) → 普通(2) → 低(3)
 *   5. 截止时间：due_at 升序，NULL 最后（用 'infinity' 归一，便于 keyset 比较）
 *   6. 任务 ID 升序：唯一兜底，保证刷新前后顺序稳定
 *
 * 「今天 / 明天 / 已逾期」按 Asia/Shanghai 的日历日由服务端计算，与任务中心
 * dueToday 统计、任务看板 dueState 同一口径；前端不得按客户端时钟重算。
 */
export interface TaskListSortKey {
  readonly statusGroup: number;
  /** 已完成任务的完成时间；未完成 / 已取消恒为 null（与 tasks_completion_state_check 同真）。 */
  readonly completedAt: Date | null;
  readonly urgency: number;
  readonly priority: number;
  readonly dueAt: Date | null;
  readonly taskId: number;
}

/**
 * 游标键版本：排序口径变化必须递增，旧版本游标按无效游标拒绝。
 * 2026-09-22 由 2 升到 3：新增「完成时间倒序」一级（已完成分组按 completed_at 从晚到早），
 * 载荷由 6 段变 7 段，旧游标继续使用会跳页 / 重项。
 * （更早一次 1 → 2：紧急桶重排，已逾期从 0 移到 2、遗留问题来源升到 0、标记紧急升到 1。）
 */
export const TASK_LIST_SORT_KEY_VERSION = 3;

interface TaskListSortExpressions {
  readonly statusGroup: PostgresFragment;
  readonly completedOrder: PostgresFragment;
  readonly urgency: PostgresFragment;
  readonly priority: PostgresFragment;
  readonly dueOrder: PostgresFragment;
}

/** 与 postgres.js 自带的 Fragment 别名一致：可作为嵌套片段插入模板。 */
type PostgresFragment = Fragment;

/**
 * 排序键各列表达式。紧急桶的 EXISTS 命中 app.leftover_task_links 的 task_id
 * 唯一索引，与前端 hasLeftoverSource 同源同口径（存在链接即视为遗留问题来源）。
 */
export function taskListSortExpressions(sql: ISql): TaskListSortExpressions {
  const statusGroup = sql`CASE t.work_status
             WHEN 'TODO' THEN 0
             WHEN 'DONE' THEN 1
             ELSE 2
           END`;
  const urgency = sql`CASE
             WHEN t.work_status <> 'TODO' THEN 4
             WHEN EXISTS (SELECT 1 FROM app.leftover_task_links l WHERE l.task_id = t.id) THEN 0
             WHEN t.priority = 'URGENT' THEN 1
             WHEN t.due_at IS NOT NULL AND t.due_at < (
               date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai'
             ) THEN 2
             WHEN t.due_at IS NOT NULL AND t.due_at < (
               (date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') + interval '2 days') AT TIME ZONE 'Asia/Shanghai'
             ) THEN 3
             ELSE 4
           END`;
  const priority = sql`CASE t.priority
             WHEN 'URGENT' THEN 0
             WHEN 'HIGH' THEN 1
             WHEN 'NORMAL' THEN 2
             ELSE 3
           END`;
  /**
   * 完成时间倒序：已完成任务取 completed_at，未完成 / 已取消用 '-infinity' 归一，
   * 使这一级在非已完成分组内恒等（NULL 不能直接参与 keyset 的逐列比较）。
   */
  const completedOrder = sql`COALESCE(t.completed_at, '-infinity'::timestamptz)`;
  const dueOrder = sql`COALESCE(t.due_at, 'infinity'::timestamptz)`;
  return { statusGroup, completedOrder, urgency, priority, dueOrder };
}

/** ORDER BY 片段（不含关键字本身）。 */
export function taskListOrderBy(sql: ISql): PostgresFragment {
  const expressions = taskListSortExpressions(sql);
  return sql`${expressions.statusGroup}, ${expressions.completedOrder} DESC, ${expressions.urgency}, ${expressions.priority}, ${expressions.dueOrder}, t.id`;
}

/**
 * keyset 断页条件：与 taskListOrderBy 同构，逐级比较排序键，NULL 截止时间用
 * 'infinity' 归一、NULL 完成时间用 '-infinity' 归一后参与比较。
 * after 为 null 时返回恒真条件（第一页）。
 */
export function taskListKeysetPredicate(
  sql: ISql,
  after: TaskListSortKey | null,
): PostgresFragment {
  if (after === null) {
    return sql`TRUE`;
  }
  const { statusGroup: g, urgency: u, priority: p } = after;
  const expressions = taskListSortExpressions(sql);
  const dueAtKey = sql`COALESCE(${after.dueAt}::timestamptz, 'infinity'::timestamptz)`;
  const completedAtKey = sql`COALESCE(${after.completedAt}::timestamptz, '-infinity'::timestamptz)`;
  return sql`(
    ${expressions.statusGroup} > ${g}
    OR (${expressions.statusGroup} = ${g} AND ${expressions.completedOrder} < ${completedAtKey})
    OR (${expressions.statusGroup} = ${g} AND ${expressions.completedOrder} = ${completedAtKey}
        AND ${expressions.urgency} > ${u})
    OR (${expressions.statusGroup} = ${g} AND ${expressions.completedOrder} = ${completedAtKey}
        AND ${expressions.urgency} = ${u} AND ${expressions.priority} > ${p})
    OR (${expressions.statusGroup} = ${g} AND ${expressions.completedOrder} = ${completedAtKey}
        AND ${expressions.urgency} = ${u} AND ${expressions.priority} = ${p}
        AND ${expressions.dueOrder} > ${dueAtKey})
    OR (${expressions.statusGroup} = ${g} AND ${expressions.completedOrder} = ${completedAtKey}
        AND ${expressions.urgency} = ${u} AND ${expressions.priority} = ${p}
        AND ${expressions.dueOrder} = ${dueAtKey} AND t.id > ${after.taskId})
  )`;
}

/**
 * 取单条任务的排序键：分页端口只在「还有下一页」时为页尾任务查一次，避免把排序键
 * 列塞进列表 SELECT 而污染公开行类型。完成时间读原始列（非「已完成」分组为 NULL），
 * 不走排序表达式里的 '-infinity' 归一，避免把归一哨兵当成真实时间回传。
 */
export async function taskListSortKeyFor(
  sql: ISql,
  taskId: number,
): Promise<TaskListSortKey | null> {
  const expressions = taskListSortExpressions(sql);
  const rows = await sql`SELECT ${expressions.statusGroup} AS "statusGroup",
                         t.completed_at AS "completedAt",
                         ${expressions.urgency} AS "urgency",
                         ${expressions.priority} AS "priority",
                         t.due_at AS "dueAt"
                    FROM app.tasks t WHERE t.id = ${taskId}`;
  const row = rows[0];
  if (row === undefined) {
    return null;
  }
  return {
    statusGroup: Number(row.statusGroup),
    // 读原始列而不是排序表达式：非「已完成」分组恒为 NULL，不必解析 '-infinity'。
    completedAt: row.completedAt === null ? null : new Date(row.completedAt),
    urgency: Number(row.urgency),
    priority: Number(row.priority),
    dueAt: row.dueAt === null ? null : new Date(row.dueAt),
    taskId,
  };
}

/** 游标载荷文本：版本|状态分组|完成时间(ISO 或空)|紧急桶|优先级|截止(ISO 或空)|任务ID。 */
export function encodeTaskListSortKey(key: TaskListSortKey): string {
  return [
    String(TASK_LIST_SORT_KEY_VERSION),
    String(key.statusGroup),
    key.completedAt === null ? "" : new Date(key.completedAt).toISOString(),
    String(key.urgency),
    String(key.priority),
    key.dueAt === null ? "" : new Date(key.dueAt).toISOString(),
    String(key.taskId),
  ].join("|");
}

/** 解析游标载荷；版本不符或字段非法时返回 null，由调用方按无效游标拒绝。 */
export function parseTaskListSortKey(raw: string): TaskListSortKey | null {
  const parts = raw.split("|");
  if (parts.length !== 7) {
    return null;
  }
  const version = parts[0]!;
  const statusGroup = parts[1]!;
  const completedAt = parts[2]!;
  const urgency = parts[3]!;
  const priority = parts[4]!;
  const dueAt = parts[5]!;
  const taskId = parts[6]!;
  if (Number(version) !== TASK_LIST_SORT_KEY_VERSION) {
    return null;
  }
  for (const value of [statusGroup, urgency, priority, taskId]) {
    if (!/^[0-9]+$/.test(value)) {
      return null;
    }
  }
  const taskIdValue = Number(taskId);
  if (taskIdValue <= 0 || !Number.isSafeInteger(taskIdValue)) {
    return null;
  }
  const dueAtValue = parseTimestampPart(dueAt);
  const completedAtValue = parseTimestampPart(completedAt);
  if (dueAtValue === "invalid" || completedAtValue === "invalid") {
    return null;
  }
  const statusGroupValue = Number(statusGroup);
  // 与 tasks_completion_state_check 同真：只有「已完成」分组带完成时间，其余分组必须为空。
  if ((statusGroupValue === 1) !== (completedAtValue !== null)) {
    return null;
  }
  return {
    statusGroup: statusGroupValue,
    completedAt: completedAtValue,
    urgency: Number(urgency),
    priority: Number(priority),
    dueAt: dueAtValue,
    taskId: taskIdValue,
  };
}

/** 游标里的时间戳字段：空串表示归一值（NULL），非法 ISO 返回 "invalid"。 */
function parseTimestampPart(raw: string): Date | null | "invalid" {
  if (raw === "") {
    return null;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "invalid" : parsed;
}
