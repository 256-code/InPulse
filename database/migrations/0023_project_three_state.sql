SET LOCAL ROLE app_owner;

-- ADR-043：项目层面下线「归档」（ARCHIVED），项目生命周期由四态收窄为三态
-- 未开始（NOT_STARTED）/ 进行中（ACTIVE）/ 维护中（MAINTENANCE）。
-- 归档申请（F-06.2 / ADR-034）随之整体下线：项目不再需要申请、审批或恢复归档，
-- 「项目下任务全部收尾」改为切换「维护中」的前置门禁，由服务端返回 409
-- PROJECT_MAINTENANCE_TASKS_OPEN 独立校验（数据库侧只负责状态枚举与历史保留）。
--
-- 本迁移只改数据与 CHECK 约束、并撤销一处写权限；不改列定义（archived_at 保留为
-- 只读历史列，迁移不可逆），不递增 row_version，不写审计（属数据迁移）。
--
-- 顺序不可颠倒：
--   1. 先 DROP projects_archive_state_check —— 该约束要求「非 ARCHIVED 时 archived_at 必须为空」，
--      若先改 status 再清 archived_at，任何一次 UPDATE 都会当场违反约束；
--   2. 再回填存量 ARCHIVED 行，让表内不存在三态之外的值；
--   3. 最后才收紧 projects_status_check，否则 ADD CONSTRAINT 会因表内仍有 ARCHIVED 行而失败。

-- 1) 摘除归档态约束，为回填让路。
ALTER TABLE app.projects
  DROP CONSTRAINT projects_archive_state_check;

-- 2) 回填是数据迁移，不递增 row_version；但 app.projects 的 projects_row_version 触发器
--    要求每次 UPDATE 恰好递增一次，因此回填期间临时关闭该触发器，结束后立即恢复。
--    整个迁移在一个事务内执行，失败回滚不会留下被关闭的触发器。
--    注意：禁用期间不要改写 row_version 列，否则重新启用后会再叠一次。
ALTER TABLE app.projects DISABLE TRIGGER projects_row_version;

-- 存量口径与 0017 对称：有产出的归档项目落「维护中」（项目确有交付成果，
-- 停在维护态最贴近原语义，也自动满足 projects_not_started_lock_check）；
-- 归档前从未有任务完成的落「未开始」，还原归档前的生命周期位置。
UPDATE app.projects
   SET status = 'MAINTENANCE'
 WHERE status = 'ARCHIVED'
   AND first_task_completed_at IS NOT NULL;

-- 此时残留的 ARCHIVED 行 first_task_completed_at 必为空，落「未开始」不会违反锁定约束。
UPDATE app.projects
   SET status = 'NOT_STARTED'
 WHERE status = 'ARCHIVED';

-- archived_at 在三态下必须恒为空；列本身保留（历史迁移不可写回，列不物理删除）。
UPDATE app.projects
   SET archived_at = NULL
 WHERE archived_at IS NOT NULL;

-- 上面的回填会挂起延迟约束触发器事件，必须先结算才能再对同一张表执行 ALTER TABLE。
SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE app.projects ENABLE TRIGGER projects_row_version;

-- 3) 收紧状态枚举：三态之外的值由数据库直接拒绝。
ALTER TABLE app.projects
  DROP CONSTRAINT projects_status_check;

ALTER TABLE app.projects
  ADD CONSTRAINT projects_status_check
  CHECK (status IN ('NOT_STARTED', 'ACTIVE', 'MAINTENANCE'));

-- 兜底不变量：项目侧不再有归档态，archived_at 永远为空；服务端也已停止写入。
ALTER TABLE app.projects
  ADD CONSTRAINT projects_archived_at_null_check
  CHECK (archived_at IS NULL);

-- 4) 归档申请是业务历史：表与历史行原样保留（不物理删除），只收回运行时的写权限，
--    使任何残留代码路径都无法再写入新的申请，读取权限保留以便追溯历史。
REVOKE INSERT, UPDATE ON app.project_archive_requests FROM app_runtime;
