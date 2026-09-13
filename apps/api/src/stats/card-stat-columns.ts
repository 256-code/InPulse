import type { ISql } from "postgres";

/**
 * 卡片统计列：项目卡、模块卡、功能卡与 R-2 项目概览共用同一份口径，
 * 避免各读取端口分别拼 SQL 造成同一指标在不同页面数字不一致。
 *
 * - `openTaskCount`：`work_status = 'TODO'` 且 `lifecycle_status <> 'INVALID'`，
 *   并排除仍挂在活跃聚合组下的历史来源分支（合并后不再计入待办，
 *   与任务查询的 effectiveOnly 一致）。
 * - `activeModuleCount` / `activeFeatureCount`：行自身 `status = 'ACTIVE'`。
 * - `recordCount`：只计 `status = 'PUBLISHED'`，不 join 影响功能
 *   （与 ChangeRecordReadPort 的计数口径一致）。
 *
 * 外层行别名由 postgres.js 标识符转义注入，不接受任意字符串；参数取 `ISql`，
 * 使读取端的 `Sql` 与事务内的 `TransactionSql` 都可复用。
 */
export type CardRowAlias = "p" | "u" | "m" | "f";

/** 统计「哪一层的待办任务」：项目卡按项目、模块卡按模块、功能卡按功能。 */
type TaskScope = "project" | "module" | "feature";

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

const openTaskCountColumn = (
  sql: ISql,
  scope: TaskScope,
  table: CardRowAlias,
) => sql`(
           SELECT COUNT(*)::integer
             FROM app.tasks t
            WHERE ${taskScopeWhere(sql, scope, table)}
              AND t.work_status = 'TODO'
              AND t.lifecycle_status <> 'INVALID'
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
              )
         ) AS "openTaskCount"`;

/** 项目卡统计列：活跃模块数、活跃功能数、待办任务数。 */
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
         ${openTaskCountColumn(sql, "project", table)}`;
}

/** 模块卡统计列：模块内活跃功能数、模块内待办任务数（含功能级任务）。 */
export function moduleStatColumns(sql: ISql, table: "m") {
  const moduleId = rowId(sql, table);
  return sql`
         (
           SELECT COUNT(*)::integer
             FROM app.features ff
            WHERE ff.module_id = ${moduleId}
              AND ff.status = 'ACTIVE'
         ) AS "activeFeatureCount",
         ${openTaskCountColumn(sql, "module", table)}`;
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
