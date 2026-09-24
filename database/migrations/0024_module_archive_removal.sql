SET LOCAL ROLE app_owner;

-- ADR-044：模块层面下线「归档」（ARCHIVED），模块不再是生命周期资源。
-- 模块只保留 ACTIVE 一种状态：模块本身没有「主体完成、只做小修小补」这一档
-- （那是项目的「维护中」），归档只带来一个只读态和一整套父级只读分支。
-- 与之配套，功能 / 任务 / 迭代记录 / 遗留项里「所属模块已归档」的写前检查分支
-- （ModuleQueryPort 的 parent-not-active、FEATURE_MODULE_ARCHIVED、
-- MODULE_ARCHIVE_TASKS_OPEN）整体下线；模块下级的归档与恢复完全不变。
--
-- 本迁移只改数据与 CHECK 约束，不改列定义（archived_at 保留为只读历史列，
-- 迁移不可逆），不递增 row_version，不写审计（属数据迁移）。
--
-- 顺序不可颠倒：
--   1. 先 DROP modules_archive_state_check —— 该约束要求「非 ARCHIVED 时 archived_at 必须为空」，
--      若先改 status 再清 archived_at，任何一次 UPDATE 都会当场违反约束；
--   2. 再回填存量 ARCHIVED 行，让表内不存在 ACTIVE 之外的值；
--   3. 最后才收紧 modules_status_check，否则 ADD CONSTRAINT 会因表内仍有 ARCHIVED 行而失败。

-- 1) 摘除归档态约束，为回填让路。
ALTER TABLE app.modules
  DROP CONSTRAINT modules_archive_state_check;

-- 2) 回填是数据迁移，不递增 row_version；但 app.modules 的 modules_row_version 触发器
--    要求每次 UPDATE 恰好递增一次，因此回填期间临时关闭该触发器，结束后立即恢复。
--    整个迁移在一个事务内执行，失败回滚不会留下被关闭的触发器。
--    注意：禁用期间不要改写 row_version 列，否则重新启用后会再叠一次。
ALTER TABLE app.modules DISABLE TRIGGER modules_row_version;

-- 存量归档模块一律回到「活跃」：模块归档从不级联改动下级状态，因此回填不会
-- 触发任何功能 / 任务 / 记录的状态变化，只是让模块重新出现在模块列表里。
UPDATE app.modules
   SET status = 'ACTIVE'
 WHERE status = 'ARCHIVED';

-- archived_at 在单态下必须恒为空；列本身保留（历史迁移不可写回，列不物理删除）。
UPDATE app.modules
   SET archived_at = NULL
 WHERE archived_at IS NOT NULL;

-- 上面的回填会挂起延迟约束触发器事件，必须先结算才能再对同一张表执行 ALTER TABLE。
SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE app.modules ENABLE TRIGGER modules_row_version;

-- 3) 收紧状态枚举：模块只有 ACTIVE，其余取值由数据库直接拒绝。
ALTER TABLE app.modules
  DROP CONSTRAINT modules_status_check;

ALTER TABLE app.modules
  ADD CONSTRAINT modules_status_check
  CHECK (status = 'ACTIVE');

-- 兜底不变量：模块侧不再有归档态，archived_at 永远为空；服务端也已停止写入。
ALTER TABLE app.modules
  ADD CONSTRAINT modules_archived_at_null_check
  CHECK (archived_at IS NULL);
