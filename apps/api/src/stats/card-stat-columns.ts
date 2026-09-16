import type { ISql } from "postgres";

/**
 * 卡片统计列：项目卡、模块卡、功能卡与 R-2 项目概览共用同一份口径，
 * 避免各读取端口分别拼 SQL 造成同一指标在不同页面数字不一致。
 *
 * - `openTaskCount`：`work_status = 'TODO'` 且 `lifecycle_status <> 'INVALID'`，
 *   并排除仍挂在活跃聚合组下的历史来源分支（合并后不再计入待办，
 *   与任务查询的 effectiveOnly 一致）。
 * - `completedTaskCount`：同一「有效任务」口径下 `work_status = 'DONE'` 的任务数；
 *   项目卡与模块卡用它判定「未开始」标签（作用域内没有已完成任务即未开始）。
 * - `activeModuleCount` / `activeFeatureCount`：行自身 `status = 'ACTIVE'`。
 * - `recordCount`：只计 `status = 'PUBLISHED'`，不 join 影响功能
 *   （与 ChangeRecordReadPort 的计数口径一致）。
 *
 * 外层行别名由 postgres.js 标识符转义注入，不接受任意字符串；参数取 `ISql`，
 * 使读取端的 `Sql` 与事务内的 `TransactionSql` 都可复用。
 */
export type CardRowAlias = "p" | "u" | "m" | "f";

/** 统计「哪一层的待办任务」：项目卡按项目、模块卡按模块、功能卡按功能。 */
export type TaskScope = "project" | "module" | "feature";

/** 外层行主键：走 postgres.js 的标识符转义，不能改写为参数占位符。 */
const rowId = (sql: ISql, table: CardRowAlias) => sql(`${table}.id`);

/**
 * 待办任务的归属条件。功能口径与 `task-management.repository.ts` 的功能任务
 * 列表一致：除本功能的任务外，模块级任务通过影响关系也计入该功能。
 */
const taskScopeWhere = (sql: ISql, scope: TaskScope, table: CardRowAlias) => {
  const id = rowId(sql, table);
  if (scope === "project") return sql`t.project_id = ${id}`;
  if (scope === "module") return sql`t.module_id = ${id}`;
  return sql`(
             (t.feature_id = ${id} AND t.scope_type = 'FEATURE')
             OR (
               t.scope_type = 'MODULE'
               AND EXISTS (
                 SELECT 1
                   FROM app.task_feature_impacts i
                  WHERE i.task_id = t.id
                    AND i.feature_id = ${id}
               )
             )
           )`;
};

/**
 * 「有效任务」条件：排除已作废任务，以及仍挂在活跃聚合组下的历史来源分支。
 * `openTaskCount` 与 `completedTaskCount` 共用，保证两个指标同一口径。
 */
const effectiveTaskWhere = (sql: ISql) => sql`t.lifecycle_status <> 'INVALID'
              AND NOT EXISTS (
                SELECT 1
                  FROM app.task_group_members gm
                  JOIN app.task_groups g
                    ON g.id = gm.group_id
                   AND g.project_id = gm.project_id
                 WHERE gm.task_id = t.id
                   AND g.status = 'ACTIVE'
                   AND gm.status = 'ACTIVE'
                   AND gm.role = 'SOURCE'
                   AND gm.source_kind = 'HISTORICAL'
              )`;

const openTaskCountColumn = (
  sql: ISql,
  scope: TaskScope,
  table: CardRowAlias,
) => sql`(
           SELECT COUNT(*)::integer
             FROM app.tasks t
            WHERE ${taskScopeWhere(sql, scope, table)}
              AND t.work_status = 'TODO'
              AND ${effectiveTaskWhere(sql)}
         ) AS "openTaskCount"`;

/** 已完成任务数：同一「有效任务」口径下的 `work_status = 'DONE'` 计数。 */
const completedTaskCountColumn = (
  sql: ISql,
  scope: TaskScope,
  table: CardRowAlias,
) => sql`(
           SELECT COUNT(*)::integer
             FROM app.tasks t
            WHERE ${taskScopeWhere(sql, scope, table)}
              AND t.work_status = 'DONE'
              AND ${effectiveTaskWhere(sql)}
         ) AS "completedTaskCount"`;

/**
 * 生命周期档位排序键：0 = 正常（`ACTIVE` 且已有完成任务）、1 = 未开始
 * （`ACTIVE` 且尚无完成任务）、2 = 已归档。前端
 * `apps/web/src/features/common/resource-lifecycle.ts` 按同一规则渲染标签，
 * 两处必须一起修改。
 */
export function lifecycleRankExpression(
  sql: ISql,
  scope: TaskScope,
  table: CardRowAlias,
) {
  return sql`CASE
             WHEN ${sql(`${table}.status`)} = 'ARCHIVED' THEN 2
             WHEN EXISTS (
               SELECT 1
                 FROM app.tasks t
                WHERE ${taskScopeWhere(sql, scope, table)}
                  AND t.work_status = 'DONE'
                  AND ${effectiveTaskWhere(sql)}
             ) THEN 0
             ELSE 1
           END`;
}

/** 项目卡统计列：活跃模块数、活跃功能数、待办任务数、已完成任务数。 */
export function projectStatColumns(sql: ISql, table: "p" | "u") {
  const projectId = rowId(sql, table);
  return sql`
         (
           SELECT COUNT(*)::integer
             FROM app.modules mm
            WHERE mm.project_id = ${projectId}
              AND mm.status = 'ACTIVE'
         ) AS "activeModuleCount",
         (
           SELECT COUNT(*)::integer
             FROM app.features ff
            WHERE ff.project_id = ${projectId}
              AND ff.status = 'ACTIVE'
         ) AS "activeFeatureCount",
         ${openTaskCountColumn(sql, "project", table)},
         ${completedTaskCountColumn(sql, "project", table)}`;
}

/** 模块卡统计列：模块内活跃功能数、模块内待办任务数与已完成任务数（含功能级任务）。 */
export function moduleStatColumns(sql: ISql, table: "m") {
  const moduleId = rowId(sql, table);
  return sql`
         (
           SELECT COUNT(*)::integer
             FROM app.features ff
            WHERE ff.module_id = ${moduleId}
              AND ff.status = 'ACTIVE'
         ) AS "activeFeatureCount",
         ${openTaskCountColumn(sql, "module", table)},
         ${completedTaskCountColumn(sql, "module", table)}`;
}

/** 功能卡统计列：功能待办任务数、已发布迭代数。 */
export function featureStatColumns(sql: ISql, table: "f") {
  const featureId = rowId(sql, table);
  return sql`
         ${openTaskCountColumn(sql, "feature", table)},
         (
           SELECT COUNT(*)::integer
             FROM app.change_records cr
            WHERE cr.feature_id = ${featureId}
              AND cr.status = 'PUBLISHED'
         ) AS "recordCount"`;
}
