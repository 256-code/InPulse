SET LOCAL ROLE app_owner;

-- ADR-054：任务层面下线「归档」（ARCHIVED）。任务已经有「完成」「取消」两条收尾
-- 路径，归档只换来一个只读态，且它的原始动机（模块 / 项目归档要求下级任务已归档）
-- 已随 ADR-043 / ADR-044 / ADR-045 全部消失。与之配套，任务生命周期命令
-- archiveTask / restoreTask / archiveModuleTask / restoreModuleTask 与
-- TaskArchiveRequest 从契约、服务、仓储、前端入口整体删除。
--
-- 本迁移只改数据与 CHECK 约束，不改列定义（lifecycle_status 列保留，迁移不可逆），
-- 不递增 row_version，不写审计（属数据迁移），不动 tasks_project_status_idx
-- （该索引仍按 project_id + lifecycle_status 过滤，收窄取值域后继续有效）。
--
-- 顺序不可颠倒：
--   1. 回填期间必须临时关闭 app.tasks 的 tasks_row_version 触发器 —— 该触发器要求
--      每次 UPDATE 恰好递增一次 row_version，而数据迁移不应改写 row_version；
--      整个迁移在一个事务内执行，失败回滚不会留下被关闭的触发器；
--   2. 回填会挂起延迟约束触发器事件，必须先 SET CONSTRAINTS ALL IMMEDIATE 结算，
--      才能在同一张表上继续 ALTER TABLE；
--   3. 最后才收紧 tasks_lifecycle_status_check，否则 ADD CONSTRAINT 会因表内仍有
--      ARCHIVED 行而失败。

-- 1) 回填存量归档任务；禁用触发器期间不要改写 row_version 列。
ALTER TABLE app.tasks DISABLE TRIGGER tasks_row_version;

-- 任务归档从不级联改动下级状态，也不写状态历史，因此回填只是让这些任务重新
-- 出现在看板与看板统计里（它们本来就出现在任务列表与任务中心里）。
UPDATE app.tasks
   SET lifecycle_status = 'ACTIVE'
 WHERE lifecycle_status = 'ARCHIVED';

SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE app.tasks ENABLE TRIGGER tasks_row_version;

-- 2) 收紧生命周期枚举：任务只剩「活跃」与「标记无效」两种，ARCHIVED 由数据库拒绝。
ALTER TABLE app.tasks
  DROP CONSTRAINT tasks_lifecycle_status_check;

ALTER TABLE app.tasks
  ADD CONSTRAINT tasks_lifecycle_status_check
  CHECK (lifecycle_status IN ('ACTIVE', 'INVALID'));
