SET LOCAL ROLE app_owner;

-- ADR-045：功能层面下线「归档」（ARCHIVED），功能不再是生命周期资源。
-- 功能只保留 ACTIVE 一种状态：功能档位改由「功能下是否已有完成任务」推导，
-- 与模块（ADR-044）同一口径，见 apps/api/src/stats/card-stat-columns.ts 的
-- lifecycleRankExpression。归档只带来一个只读态和一整套父级只读分支。
-- 与之配套，任务 / 聚合组 / 迭代记录 / 遗留项里「所属功能已归档」的写前检查分支
-- 整体下线：FeatureQueryPort.checkFeatureForWrite 不再有 parent-not-active，
-- TASK_PARENT_ARCHIVED / TASK_IMPACT_ARCHIVED / TASK_MERGE_PARENT_ARCHIVED /
-- LEFTOVER_PARENT_ARCHIVED 与「排除归档影响功能」一并删除；功能自身的编辑
-- 以及任务、聚合组、记录、遗留项的归档逻辑完全不变。
--
-- 本迁移只改数据、CHECK 约束与一处索引，不改列定义（archived_at 保留为只读历史列，
-- 迁移不可逆），不递增 row_version，不写审计（属数据迁移）。
--
-- 顺序不可颠倒：
--   1. 先 DROP features_archive_state_check —— 该约束要求「非 ARCHIVED 时 archived_at 必须为空」，
--      若先改 status 再清 archived_at，任何一次 UPDATE 都会当场违反约束；
--   2. 再回填存量 ARCHIVED 行，让表内不存在 ACTIVE 之外的值；
--   3. 最后才收紧 features_status_check，否则 ADD CONSTRAINT 会因表内仍有 ARCHIVED 行而失败。

-- 1) 摘除归档态约束，为回填让路。
ALTER TABLE app.features
  DROP CONSTRAINT features_archive_state_check;

-- 2) 回填是数据迁移，不递增 row_version；但 app.features 的 features_row_version 触发器
--    要求每次 UPDATE 恰好递增一次，因此回填期间临时关闭该触发器，结束后立即恢复。
--    整个迁移在一个事务内执行，失败回滚不会留下被关闭的触发器。
--    注意：禁用期间不要改写 row_version 列，否则重新启用后会再叠一次。
ALTER TABLE app.features DISABLE TRIGGER features_row_version;

-- 存量归档功能一律回到「活跃」：功能归档从不级联改动下级状态，因此回填不会
-- 触发任何任务 / 记录的状态变化，只是让功能重新出现在功能列表里。
UPDATE app.features
   SET status = 'ACTIVE'
 WHERE status = 'ARCHIVED';

-- archived_at 在单态下必须恒为空；列本身保留（历史迁移不可写回，列不物理删除）。
UPDATE app.features
   SET archived_at = NULL
 WHERE archived_at IS NOT NULL;

-- 上面的回填会挂起延迟约束触发器事件，必须先结算才能再对同一张表执行 ALTER TABLE。
SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE app.features ENABLE TRIGGER features_row_version;

-- 3) 收紧状态枚举：功能只有 ACTIVE，其余取值由数据库直接拒绝。
ALTER TABLE app.features
  DROP CONSTRAINT features_status_check;

ALTER TABLE app.features
  ADD CONSTRAINT features_status_check
  CHECK (status = 'ACTIVE');

-- 兜底不变量：功能侧不再有归档态，archived_at 永远为空；服务端也已停止写入。
ALTER TABLE app.features
  ADD CONSTRAINT features_archived_at_null_check
  CHECK (archived_at IS NULL);

-- 4) status 已成常量列，留在复合索引里只会挡住「按 (project_id, module_id) 过滤 +
--    按 id 排序」这条功能列表索引路径（与 0021 删除随列失效的
--    tasks_assignee_status_idx 同一处理）。重建为去掉 status 的三列索引。
DROP INDEX app.features_module_status_idx;

CREATE INDEX features_module_id_idx
  ON app.features USING btree (project_id, module_id, id);
